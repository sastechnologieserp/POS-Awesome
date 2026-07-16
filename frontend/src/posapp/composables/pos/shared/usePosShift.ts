import { ref, getCurrentInstance, inject } from "vue";
import { useToastStore } from "../../../stores/toastStore.js";
import { prefetchPrintTemplate } from "../../../plugins/print";
import { useUIStore } from "../../../stores/uiStore.js";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import {
	initPromise,
	checkDbHealth,
	getOpeningStorage,
	setOpeningStorage,
	clearOpeningStorage,
	setTaxTemplate,
	isOffline,
	getBootstrapSnapshot,
	setBootstrapSnapshot,
} from "../../../../offline/index";
import { getValidCachedOpeningForCurrentUser } from "../../../utils/openingCache";
import { createBootstrapSnapshotFromRegisterData } from "../../../../offline/bootstrapSnapshot";

declare const __BUILD_VERSION__: string;
declare const frappe: any;

type SkippedPrintedInvoice = {
	invoice?: string;
	doctype?: string;
	return_against?: string;
};

type ClosingShiftPreparationResponse = {
	closing_shift?: any;
	skipped_printed_invoices?: SkippedPrintedInvoice[];
};

const translateMessage = (value: string) => (typeof window !== "undefined" && window.__
	? window.__(value)
	: value);

export function buildSkippedClosingInvoicesPrompt(
	skippedInvoices: SkippedPrintedInvoice[],
) {
	const count = skippedInvoices.length;
	const baseMessage = count === 1
		? "1 printed return invoice references a cancelled invoice and will be excluded from closing."
		: `${count} printed return invoices reference cancelled invoices and will be excluded from closing.`;
	const details = skippedInvoices
		.slice(0, 5)
		.map((invoice) => {
			const invoiceName = invoice?.invoice || translateMessage("Unknown invoice");
			const returnAgainst = invoice?.return_against;
			return returnAgainst
				? `${invoiceName} (${translateMessage("Return Against")}: ${returnAgainst})`
				: invoiceName;
		})
		.join(", ");
	const detailMessage = details
		? `${translateMessage("Invoices")}: ${details}.`
		: "";
	return [
		translateMessage(baseMessage),
		detailMessage,
		translateMessage("The skipped invoice will remain a draft."),
		translateMessage("Do you want to proceed?"),
	]
		.filter(Boolean)
		.join(" ");
}

function normalizeClosingShiftPreparationResponse(
	payload: any,
): ClosingShiftPreparationResponse {
	if (payload?.closing_shift || payload?.skipped_printed_invoices) {
		return payload;
	}

	return {
		closing_shift: payload,
		skipped_printed_invoices: [],
	};
}

export function usePosShift(openDialog?: () => void) {
	const instance = getCurrentInstance();
	const proxy: any = instance?.proxy;
	const eventBus: any = proxy?.eventBus || inject("eventBus");
	const buildVersion =
		typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : null;
	const toastStore = useToastStore();
	const uiStore = useUIStore();

	const pos_profile = ref<any>(null);
	const pos_opening_shift = ref<any>(null);

	function applyRegisterData(data: any) {
		if (!data) {
			return;
		}
		pos_profile.value = data.pos_profile;
		pos_opening_shift.value = data.pos_opening_shift;
		uiStore.setRegisterData(data);
		setBootstrapSnapshot(
			createBootstrapSnapshotFromRegisterData(
				data,
				getBootstrapSnapshot(),
				{ buildVersion },
			),
		);

		try {
			frappe.realtime.emit("pos_profile_registered");
		} catch (e) {
			console.warn("Realtime emit failed", e);
		}
	}

	async function check_opening_entry() {
		await initPromise;
		await checkDbHealth();
		const cachedOpening = getValidCachedOpeningForCurrentUser(
			getOpeningStorage(),
			frappe?.session?.user,
		);
		if (cachedOpening) {
			applyRegisterData(cachedOpening);
			console.info("LoadPosProfile (bootstrapped from cache)");
			if (pos_profile.value) {
				prefetchPrintTemplate(pos_profile.value).catch(console.error);
			}
		}
		return frappe
			.call("posawesome.posawesome.api.shifts.check_opening_shift", {
				user: frappe.session.user,
			})
			.then((r: any) => {
				if (r.message) {
					applyRegisterData(r.message);
					if (pos_profile.value) {
						prefetchPrintTemplate(pos_profile.value).catch(console.error);
					}
					if (pos_profile.value.taxes_and_charges) {
						frappe.call({
							method: "frappe.client.get",
							args: {
								doctype: "Sales Taxes and Charges Template",
								name: pos_profile.value.taxes_and_charges,
							},
							callback: (res: any) => {
								if (res.message) {
									setTaxTemplate(
										pos_profile.value.taxes_and_charges,
										res.message,
									);
								}
							},
						});
					}
					console.info("LoadPosProfile");
					try {
						setOpeningStorage(r.message);
					} catch (e) {
						console.error("Failed to cache opening data", e);
					}
				} else {
					console.info("No opening shift found, opening dialog");
					clearOpeningStorage();
					openDialog && openDialog();
				}
			})
			.catch((err: unknown) => {
				console.error("Error checking opening entry", err);
				const data = cachedOpening ||
					getValidCachedOpeningForCurrentUser(
						getOpeningStorage(),
						frappe?.session?.user,
					);
				if (data) {
					applyRegisterData(data);
					console.info("LoadPosProfile (cached)");
					return;
				}
				if (!isOffline()) {
					clearOpeningStorage();
				}
				openDialog && openDialog();
			});
	}

	function get_closing_data() {
		const cachedOpeningShift = (getOpeningStorage() as any)
			?.pos_opening_shift;
		const resolvedShift =
			uiStore.posOpeningShift ||
			pos_opening_shift.value ||
			cachedOpeningShift ||
			null;
		if (!resolvedShift) {
			return Promise.resolve();
		}
		return frappe
			.call(
				"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.make_closing_shift_from_opening",
				{ opening_shift: resolvedShift },
			)
			.then((r: any) => {
				if (r.message) {
					const response = normalizeClosingShiftPreparationResponse(r.message);
					const closingShift = response.closing_shift;
					const skippedPrintedInvoices = Array.isArray(response.skipped_printed_invoices)
						? response.skipped_printed_invoices
						: [];
					if (!closingShift) {
						return;
					}

					if (skippedPrintedInvoices.length) {
						const confirmed = window.confirm(
							buildSkippedClosingInvoicesPrompt(skippedPrintedInvoices),
						);
						if (!confirmed) {
							return;
						}
					}

					eventBus?.emit("open_ClosingDialog", closingShift);
				}
			});
	}

	function print_cashier_shift_report(closing_shift_name: string, profile: any) {
		frappe.call({
			method: "posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.direct_print_cashier_shift_report",
			args: {
				closing_shift_name: closing_shift_name,
			},
			callback: (r: any) => {
				if (r.message) {
					const html_content = r.message;
					const silent_print = profile && profile.posa_silent_print;

					if (silent_print) {
						// Show in the same tab as iframe
						const iframeId = "posa-closing-shift-print-frame";
						const existingFrame = document.getElementById(iframeId);
						if (existingFrame) {
							existingFrame.remove();
						}

						const iframe = document.createElement("iframe");
						iframe.id = iframeId;
						iframe.style.position = "fixed";
						iframe.style.right = "0";
						iframe.style.bottom = "0";
						iframe.style.width = "0";
						iframe.style.height = "0";
						iframe.style.border = "0";

						document.body.appendChild(iframe);
						const win = iframe.contentWindow;
						if (win) {
							win.document.open();
							win.document.write(html_content);
							win.document.close();

							const triggerPrint = () => {
								win.focus();
								try {
									win.print();
								} catch (err) {
									console.error("Iframe printing failed", err);
								}
							};

							let printTriggered = false;
							iframe.onload = () => {
								if (!printTriggered) {
									printTriggered = true;
									triggerPrint();
								}
							};

							setTimeout(() => {
								if (!printTriggered) {
									printTriggered = true;
									triggerPrint();
								}
							}, 1000);

							setTimeout(() => iframe.remove(), 60000);
						}
					} else {
						// Open the print in the new tab in same window
						const printWindow = window.open("", "_blank");
						if (printWindow) {
							printWindow.document.open();
							printWindow.document.write(html_content);
							printWindow.document.close();

							const triggerPrint = () => {
								printWindow.focus();
								try {
									printWindow.print();
								} catch (err) {
									console.error("Popup printing failed", err);
								}
							};

							let printTriggered = false;
							printWindow.onload = () => {
								if (!printTriggered) {
									printTriggered = true;
									triggerPrint();
								}
							};

							setTimeout(() => {
								if (!printTriggered) {
									printTriggered = true;
									triggerPrint();
								}
							}, 1000);
						}
					}
				}
			},
		});
	}

	function submit_closing_pos(data: any) {
		console.log("Submitting closing shift", data);
		frappe
			.call(
				"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.submit_closing_shift",
				{
					closing_shift: JSON.stringify(data),
				},
			)
			.then((r: any) => {
				console.log("Submit result", r);
				if (r.message) {
					const currentProfile = pos_profile.value;
					const closedShiftName = r.message.name;

					pos_profile.value = null;
					pos_opening_shift.value = null;
					uiStore.posOpeningShift = null;
					clearOpeningStorage();
					useInvoiceStore().clear();
					toastStore.show({
						title: "POS Shift Closed",
						color: "success",
					});
					check_opening_entry();

					if (closedShiftName) {
						print_cashier_shift_report(closedShiftName, currentProfile);
					}
				}
			})
			.catch((err: unknown) => {
				console.error("Failed to submit closing shift", err);
			});
	}

	function print_last_closing_shift(pos_profile_to_use: any = null) {
		frappe
			.call(
				"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.get_last_closed_shift",
				{
					pos_profile: pos_profile_to_use,
				},
			)
			.then((r: any) => {
				const closing_shift_name = r && r.message;
				if (!closing_shift_name) {
					toastStore.show({
						title: "No previous closing shift found",
						color: "warning",
					});
					return;
				}
				print_cashier_shift_report(closing_shift_name, pos_profile_to_use);
			})
			.catch((e: any) => {
				console.error("Failed to load last closing shift", e);
				toastStore.show({
					title: "Failed to print last closing shift",
					color: "error",
				});
			});
	}

	return {
		pos_profile,
		pos_opening_shift,
		check_opening_entry,
		get_closing_data,
		submit_closing_pos,
		print_cashier_shift_report,
		print_last_closing_shift,
	};
}
