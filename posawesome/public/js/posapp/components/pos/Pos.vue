	<template>
	<div ref="posRoot" class="pos-main-container dynamic-container" :style="responsiveStyles">
		<ClosingDialog></ClosingDialog>
		<Drafts></Drafts>
		<SalesOrders></SalesOrders>
		<Returns></Returns>
		<NewAddress></NewAddress>
		<MpesaPayments></MpesaPayments>
		<Variants></Variants>
		<OpeningDialog v-if="dialog" :dialog="dialog"></OpeningDialog>
		<v-row v-show="!dialog" dense class="ma-0 dynamic-main-row">
			<v-col
				v-show="!payment && !offers && !coupons"
				xl="5"
				lg="5"
				md="5"
				sm="5"
				cols="12"
				class="pos dynamic-col"
			>
				<ItemsSelector></ItemsSelector>
			</v-col>
			<v-col v-show="offers" xl="5" lg="5" md="5" sm="5" cols="12" class="pos dynamic-col">
				<PosOffers></PosOffers>
			</v-col>
			<v-col v-show="coupons" xl="5" lg="5" md="5" sm="5" cols="12" class="pos dynamic-col">
				<PosCoupons></PosCoupons>
			</v-col>
			<v-col v-show="payment" xl="5" lg="5" md="5" sm="5" cols="12" class="pos dynamic-col">
				<Payments></Payments>
			</v-col>

			<v-col xl="7" lg="7" md="7" sm="7" cols="12" class="pos dynamic-col">
				<Invoice></Invoice>
			</v-col>
		</v-row>
	</div>
</template>

<script>
import ItemsSelector from "./ItemsSelector.vue";
import Invoice from "./Invoice.vue";
import OpeningDialog from "./OpeningDialog.vue";
import Payments from "./Payments.vue";
import PosOffers from "./PosOffers.vue";
import PosCoupons from "./PosCoupons.vue";
import Drafts from "./Drafts.vue";
import SalesOrders from "./SalesOrders.vue";
import ClosingDialog from "./ClosingDialog.vue";
import NewAddress from "./NewAddress.vue";
import Variants from "./Variants.vue";
import Returns from "./Returns.vue";
import MpesaPayments from "./Mpesa-Payments.vue";
import {
	getCachedOffers,
	saveOffers,
	getOpeningStorage,
	setOpeningStorage,
	clearOpeningStorage,
	initPromise,
	checkDbHealth,
	setTaxTemplate,
} from "../../../offline/index.js";
// Import the cache cleanup function
import { clearExpiredCustomerBalances } from "../../../offline/index.js";
import { responsiveMixin } from "../../mixins/responsive.js";

export default {
	mixins: [responsiveMixin],
	data: function () {
		return {
			dialog: false,
			pos_profile: "",
			pos_opening_shift: "",
			payment: false,
			offers: false,
			coupons: false,
			tableFocusObserver: null,
			tableFocusObserverRaf: null,
			globalEscapeHandler: null,
		};
	},

	components: {
		ItemsSelector,
		Invoice,
		OpeningDialog,
		Payments,
		Drafts,
		ClosingDialog,

		Returns,
		PosOffers,
		PosCoupons,
		NewAddress,
		Variants,
		MpesaPayments,
		SalesOrders,
			is_closing_shift_submitting: false,
	},

	methods: {
		async check_opening_entry() {
			await initPromise;
			await checkDbHealth();
			return frappe
				.call("posawesome.posawesome.api.shifts.check_opening_shift", {
					user: frappe.session.user,
				})
				.then((r) => {
					if (r.message) {
						this.pos_profile = r.message.pos_profile;
						this.pos_opening_shift = r.message.pos_opening_shift;
						this.get_offers(this.pos_profile.name);
						if (this.pos_profile.taxes_and_charges) {
							frappe.call({
								method: "frappe.client.get",
								args: {
									doctype: "Sales Taxes and Charges Template",
									name: this.pos_profile.taxes_and_charges,
								},
								callback: (res) => {
									if (res.message) {
										setTaxTemplate(this.pos_profile.taxes_and_charges, res.message);
									}
								},
							});
						}
						this.eventBus.emit("register_pos_profile", r.message);
						this.eventBus.emit("set_company", r.message.company);
						try {
							frappe.realtime.emit("pos_profile_registered");
						} catch (e) {
							console.warn("Realtime emit failed", e);
						}
						console.info("LoadPosProfile");
						try {
							setOpeningStorage(r.message);
						} catch (e) {
							console.error("Failed to cache opening data", e);
						}
					} else {
						const data = getOpeningStorage();
						if (data) {
							// Log POS profile settings for offline mode debugging
							console.log("Offline Mode - POS Profile Settings:", {
								name: data.pos_profile.name,
								currency: data.pos_profile.currency,
								disable_rounded_total: data.pos_profile.disable_rounded_total,
								posa_decimal_precision: data.pos_profile.posa_decimal_precision,
								print_format: data.pos_profile.print_format
							});
							
							this.pos_profile = data.pos_profile;
							this.pos_opening_shift = data.pos_opening_shift;
							this.get_offers(this.pos_profile.name);
							this.eventBus.emit("register_pos_profile", data);
							this.eventBus.emit("set_company", data.company);
							try {
								frappe.realtime.emit("pos_profile_registered");
							} catch (e) {
								console.warn("Realtime emit failed", e);
							}
							console.info("LoadPosProfile (cached)");
							return;
						}
						this.create_opening_voucher();
					}
				})
				.catch(() => {
					const data = getOpeningStorage();
					if (data) {
						// Log POS profile settings for offline mode debugging
						console.log("Offline Mode - POS Profile Settings:", {
							name: data.pos_profile.name,
							currency: data.pos_profile.currency,
							disable_rounded_total: data.pos_profile.disable_rounded_total,
							posa_decimal_precision: data.pos_profile.posa_decimal_precision,
							print_format: data.pos_profile.print_format
						});
						
						this.pos_profile = data.pos_profile;
						this.pos_opening_shift = data.pos_opening_shift;
						this.get_offers(this.pos_profile.name);
						this.eventBus.emit("register_pos_profile", data);
						this.eventBus.emit("set_company", data.company);
						try {
							frappe.realtime.emit("pos_profile_registered");
						} catch (e) {
							console.warn("Realtime emit failed", e);
						}
						console.info("LoadPosProfile (cached)");
						return;
					}
					this.create_opening_voucher();
				});
		},
		create_opening_voucher() {
			this.dialog = true;
		},
		get_closing_data() {
			return frappe
				.call(
					"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.make_closing_shift_from_opening",
					{
						opening_shift: this.pos_opening_shift,
					},
				)
				.then((r) => {
					if (r.message) {
						this.eventBus.emit("open_ClosingDialog", r.message);
					} else {
						// No action needed
					}
				});
		},
		submit_closing_pos(data) {
			if (this.is_closing_shift_submitting) {
				return;
			}

			this.is_closing_shift_submitting = true;
			frappe
				.call(
					"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.submit_closing_shift",
					{
						closing_shift: data,
					},
				)
				.then((r) => {
					if (r.message) {
						// Clear the cached opening shift data
						this.pos_opening_shift = null;
						this.pos_profile = null;

						// Clear from local storage
						clearOpeningStorage();

						this.eventBus.emit("show_message", {
							title: `POS Shift Closed`,
							color: "success",
						});
						
						// Auto-print the cashier shift report
						this.print_cashier_shift_report(r.message);
						
						this.check_opening_entry();
					} else {
						// No action needed
					}
				})
				.catch((e) => {
					console.error("Failed to close POS shift", e);
					this.eventBus.emit("show_message", {
						title: "Failed to close POS shift",
						color: "error",
					});
				})
				.finally(() => {
					this.is_closing_shift_submitting = false;
				});
		},

		print_last_closing_shift(pos_profile = null) {
			frappe
				.call(
					"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.get_last_closed_shift",
					{
						pos_profile: pos_profile,
					},
				)
				.then((r) => {
					const closing_shift_name = r && r.message;
					if (!closing_shift_name) {
						this.eventBus.emit("show_message", {
							title: "No previous closing shift found",
							color: "warning",
						});
						return;
					}
					this.print_cashier_shift_report(closing_shift_name);
				})
				.catch((e) => {
					console.error("Failed to load last closing shift", e);
					this.eventBus.emit("show_message", {
						title: "Failed to print last closing shift",
						color: "error",
					});
				});
		},
		
		print_cashier_shift_report(closing_shift_name) {
			// Get the HTML content directly from backend
			frappe.call({
				method: "posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.direct_print_cashier_shift_report",
				args: {
					closing_shift_name: closing_shift_name
				},
				callback: (r) => {
					if (r.message) {
						const html_content = r.message;
						
						// Create a new window with the HTML content
						const printWindow = window.open('', '_blank', 'width=' + screen.width + ',height=' + screen.height);
						printWindow.document.open();
						printWindow.document.write(html_content);
						printWindow.document.close();	// Wait for content to load then print
						printWindow.onload = function() {
							printWindow.print();
						};
						
						// Fallback if onload doesn't work
						setTimeout(() => {
							printWindow.print();
						}, 1000);
					}
				}
			});
		},
		get_offers(pos_profile) {
			// Load cached offers if available
			if (this.pos_profile && this.pos_profile.posa_local_storage) {
				const cached = getCachedOffers();
				if (cached.length) {
					this.eventBus.emit("set_offers", cached);
				}
			}

			return frappe
				.call("posawesome.posawesome.api.offers.get_offers", {
					profile: pos_profile,
				})
				.then((r) => {
					if (r.message) {
						console.info("LoadOffers");
						saveOffers(r.message);
						this.eventBus.emit("set_offers", r.message);
					}
				})
				.catch((err) => {
					console.error("Failed to fetch offers:", err);
					const cached = getCachedOffers();
					if (cached.length) {
						this.eventBus.emit("set_offers", cached);
					}
				});
		},
		get_pos_setting() {
			frappe.db.get_doc("POS Settings", undefined).then((doc) => {
				this.eventBus.emit("set_pos_settings", doc);
			});
		},
		sanitizeGlobalTableTabStops() {
			this.$nextTick(() => {
				const root = this.$refs.posRoot || this.$el;
				if (!root) {
					return;
				}

				const nonInteractiveTableSelectors = [
					"table",
					"thead",
					"tbody",
					"tr",
					"th",
					"td",
					".v-table",
					".v-table__wrapper",
					".v-data-table",
					".v-data-table-virtual",
					"[role='table']",
					"[role='grid']",
					"[role='row']",
					"[role='cell']",
					"[role='gridcell']",
					"[role='columnheader']",
					"[role='rowheader']",
				].join(",");

				root.querySelectorAll(nonInteractiveTableSelectors).forEach((el) => {
					el.setAttribute("tabindex", "-1");
				});

				// Keep header controls out of tab flow.
				root.querySelectorAll("thead button, th button, [role='columnheader'] button").forEach((el) => {
					el.setAttribute("tabindex", "-1");
				});

				const interactiveSelectors = [
					"table input",
					"table select",
					"table textarea",
					"table button",
					".v-table input",
					".v-table select",
					".v-table textarea",
					".v-table button",
					".v-data-table input",
					".v-data-table select",
					".v-data-table textarea",
					".v-data-table button",
					".v-data-table-virtual input",
					".v-data-table-virtual select",
					".v-data-table-virtual textarea",
					".v-data-table-virtual button",
				].join(",");

				root.querySelectorAll(interactiveSelectors).forEach((el) => {
					if (el.closest("thead, th, [role='columnheader']")) {
						el.setAttribute("tabindex", "-1");
						return;
					}

					const isDisabled =
						el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
					el.setAttribute("tabindex", isDisabled ? "-1" : "0");
				});
			});
		},
		startTableFocusObserver() {
			if (this.tableFocusObserver) {
				return;
			}

			const root = this.$refs.posRoot || this.$el;
			if (!root || typeof MutationObserver === "undefined") {
				return;
			}

			this.tableFocusObserver = new MutationObserver(() => {
				if (this.tableFocusObserverRaf) {
					cancelAnimationFrame(this.tableFocusObserverRaf);
				}

				this.tableFocusObserverRaf = requestAnimationFrame(() => {
					this.sanitizeGlobalTableTabStops();
					this.tableFocusObserverRaf = null;
				});
			});

			this.tableFocusObserver.observe(root, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["tabindex", "role", "class"],
			});
		},
		stopTableFocusObserver() {
			if (this.tableFocusObserver) {
				this.tableFocusObserver.disconnect();
				this.tableFocusObserver = null;
			}

			if (this.tableFocusObserverRaf) {
				cancelAnimationFrame(this.tableFocusObserverRaf);
				this.tableFocusObserverRaf = null;
			}
		},
		handleGlobalEscape(event) {
			if (!event || event.key !== "Escape") {
				return;
			}

			if (event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}

			// Only toggle search focus from the sales screen.
			if (this.dialog || this.payment || this.offers || this.coupons) {
				return;
			}

			this.eventBus.emit("toggle_item_search_focus");
		},
	},

	mounted: function () {
		this.$nextTick(function () {
			this.check_opening_entry();
			this.get_pos_setting();
			this.eventBus.on("close_opening_dialog", () => {
				this.dialog = false;
			});
			this.eventBus.on("register_pos_data", (data) => {
				this.pos_profile = data.pos_profile;
				this.get_offers(this.pos_profile.name);
				this.pos_opening_shift = data.pos_opening_shift;
				this.eventBus.emit("register_pos_profile", data);
				console.info("LoadPosProfile");
			});
			this.eventBus.on("show_payment", (data) => {
				this.payment = data === "true";
				this.offers = false;
				this.coupons = false;
			});
			this.eventBus.on("show_offers", (data) => {
				this.offers = data === "true";
				this.payment = false;
				this.coupons = false;
			});
			this.eventBus.on("show_coupons", (data) => {
				this.coupons = data === "true";
				this.offers = false;
				this.payment = false;
			});
			this.eventBus.on("open_closing_dialog", () => {
				this.get_closing_data();
			});
			this.eventBus.on("submit_closing_pos", (data) => {
				this.submit_closing_pos(data);
			});
				this.eventBus.on("print_last_closing_shift", (pos_profile) => {
					this.print_last_closing_shift(pos_profile);
				});
			this.sanitizeGlobalTableTabStops();
			this.startTableFocusObserver();
				this.globalEscapeHandler = this.handleGlobalEscape.bind(this);
				window.addEventListener("keydown", this.globalEscapeHandler);
		});
	},
	beforeUnmount() {
			if (this.globalEscapeHandler) {
				window.removeEventListener("keydown", this.globalEscapeHandler);
				this.globalEscapeHandler = null;
			}

		this.stopTableFocusObserver();
		this.eventBus.off("close_opening_dialog");
		this.eventBus.off("register_pos_data");
		this.eventBus.off("LoadPosProfile");
		this.eventBus.off("show_payment");
		this.eventBus.off("show_offers");
		this.eventBus.off("show_coupons");
		this.eventBus.off("open_closing_dialog");
		this.eventBus.off("submit_closing_pos");
		this.eventBus.off("print_last_closing_shift");
	},
	// In the created() or mounted() lifecycle hook
	created() {
		// Clean up expired customer balance cache on POS load
		clearExpiredCustomerBalances();
	},
};
</script>

<style scoped>
.dynamic-container {
	/* add space for the navbar with better spacing */
	padding-top: var(--dynamic-lg);
	/* Navbar height (25px) + larger spacing */
	transition: all 0.3s ease;
}

.dynamic-main-row {
	padding: 0;
	margin: 0;
}

.dynamic-col {
	padding: var(--dynamic-sm);
	transition: padding 0.3s ease;
	margin-top: var(--dynamic-sm);
	/* Add top margin for better separation */
}

@media (max-width: 768px) {
	.dynamic-container {
		padding-top: calc(56px + var(--dynamic-md));
		/* Consistent navbar height + medium spacing */
	}

	.dynamic-col {
		padding: var(--dynamic-xs);
		margin-top: var(--dynamic-xs);
	}
}
</style>
