import renderOfflineInvoiceHTML from "../../offline_print_template";
import { getOpeningStorage } from "../../offline/index.js";
import { emitter } from "../bus.js";

async function generatePrintURL({ doctype, name, print_format, no_letterhead, trigger_print }) {
	const baseUrl = frappe.urllib.get_base_url();
	const params = new URLSearchParams({
		doctype,
		name,
		format: print_format,
		no_letterhead: String(no_letterhead),
		_: String(Date.now()),
	});
	if (trigger_print) {
		params.set("trigger_print", "1");
	}
	return `${baseUrl}/printview?${params.toString()}`;
}

async function generateMultiPrintURL({
	doctype,
	names,
	print_format,
	no_letterhead,
	letterhead,
	pdf_options,
}) {
	const baseUrl = frappe.urllib.get_base_url();
	const params = new URLSearchParams({
		doctype,
		name: JSON.stringify(names),
		format: print_format,
		no_letterhead: String(no_letterhead),
		letterhead,
		options: JSON.stringify(pdf_options || { "page-size": "A4" }),
		_: String(Date.now()),
	});
	return `${baseUrl}/api/method/frappe.utils.print_format.download_multi_pdf?${params.toString()}`;
}

function normalizePrintPayload(payload) {
	if (typeof payload !== "string") {
		return payload || null;
	}

	try {
		const url = new URL(payload, frappe.urllib.get_base_url());
		return {
			doctype: url.searchParams.get("doctype"),
			name: url.searchParams.get("name"),
			print_format: url.searchParams.get("format"),
			no_letterhead: url.searchParams.get("no_letterhead") || "0",
		};
	} catch (error) {
		console.error("Unable to read print URL", error);
		return null;
	}
}

async function loadPrintFormats({ doctype, selectedFormat, printFormats = [] }) {
	const formats = new Set([selectedFormat, ...printFormats].filter(Boolean));

	if (!doctype) {
		return Array.from(formats);
	}

	try {
		const response = await frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Print Format",
				filters: {
					doc_type: doctype,
					disabled: 0,
				},
				fields: ["name"],
				limit_page_length: 100,
				order_by: "name asc",
			},
		});
		(response.message || []).forEach((format) => {
			if (format?.name) {
				formats.add(format.name);
			}
		});
	} catch (error) {
		console.error(`Failed to load ${doctype} print formats`, error);
	}

	if (!formats.size) {
		formats.add("Standard");
	}

	return Array.from(formats);
}

function updateFormatSelect(select, formats, selectedFormat) {
	select.innerHTML = "";
	formats.forEach((format) => {
		const option = document.createElement("option");
		option.value = format;
		option.textContent = format;
		option.selected = format === selectedFormat;
		select.appendChild(option);
	});
}

async function openPrintDialogInHiddenIframe(
	url,
	{
		iframeId = `posa-print-frame-${Date.now()}`,
		cleanupDelay = 60000,
		onError,
		invoiceDoc,
		printPayload,
		html,
	} = {},
) {
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

	const cleanup = () => setTimeout(() => iframe.remove(), cleanupDelay);

	return new Promise((resolve) => {
		iframe.onload = async () => {
			try {
				const win = iframe.contentWindow;
				if (!win || win.closed) {
					throw new Error("Print iframe inaccessible");
				}
				win.focus();
				win.print();

				// Cache the print HTML and invoice doc for offline printing
				if (invoiceDoc && printPayload && printPayload.doctype === "Sales Invoice" && !html) {
					try {
						const printHtml = win.document.documentElement.innerHTML;
						const formatName = printPayload.print_format || "Standard";
						localStorage.setItem(`posa_print_template_html_${formatName}`, printHtml);
						localStorage.setItem(
							`posa_print_template_doc_${formatName}`,
							JSON.stringify(invoiceDoc),
						);
						console.log(`Cached print format template for: ${formatName}`);
					} catch (e) {
						console.warn("Failed to cache print format HTML from iframe:", e);
					}
				}
			} catch (error) {
				if (onError) {
					await onError(error);
				}
			} finally {
				cleanup();
				resolve();
			}
		};

		iframe.onerror = async () => {
			if (onError) {
				await onError(new Error("Print iframe failed to load"));
			}
			cleanup();
			resolve();
		};

		if (html) {
			document.body.appendChild(iframe);
			const win = iframe.contentWindow;
			if (win) {
				win.document.open();
				win.document.write(html);
				win.document.close();
			}
		} else {
			iframe.src = url;
			document.body.appendChild(iframe);
		}
	});
}

async function showPrintPreview(
	payload,
	{
		overlayId = "posa-print-preview",
		iframeId = "posa-print-preview-frame",
		buildURL = generatePrintURL,
		invoiceDoc = null,
		html = null,
	} = {},
) {
	const existingPreview = document.getElementById(overlayId);
	if (existingPreview) {
		existingPreview.remove();
	}

	const selectedFormat = payload.print_format || "Standard";
	const printFormats = await loadPrintFormats({
		doctype: payload.doctype,
		selectedFormat,
		printFormats: payload.print_formats,
	});
	const overlay = document.createElement("div");
	overlay.id = overlayId;
	overlay.style.position = "fixed";
	overlay.style.inset = "0";
	overlay.style.zIndex = "1050";
	overlay.style.background = "rgba(0, 0, 0, 0.55)";
	overlay.style.display = "flex";
	overlay.style.alignItems = "center";
	overlay.style.justifyContent = "center";
	overlay.style.padding = "24px";

	const panel = document.createElement("div");
	panel.style.width = "min(1100px, 96vw)";
	panel.style.height = "min(860px, 94vh)";
	panel.style.background = "#ffffff";
	panel.style.borderRadius = "6px";
	panel.style.boxShadow = "0 16px 48px rgba(0, 0, 0, 0.28)";
	panel.style.display = "flex";
	panel.style.flexDirection = "column";
	panel.style.overflow = "hidden";

	const toolbar = document.createElement("div");
	toolbar.style.padding = "12px";
	toolbar.style.borderBottom = "1px solid #d1d8dd";
	toolbar.style.background = "#f7fafc";

	const heading = document.createElement("div");
	heading.textContent = __("Print Format");
	heading.style.fontSize = "13px";
	heading.style.fontWeight = "600";
	heading.style.color = "#1f272e";
	heading.style.marginBottom = "8px";

	const select = document.createElement("select");
	select.style.width = "100%";
	select.style.height = "36px";
	select.style.border = "1px solid #d1d8dd";
	select.style.borderRadius = "4px";
	select.style.padding = "0 10px";
	select.style.background = "#ffffff";
	select.style.color = "#1f272e";
	select.setAttribute("aria-label", __("Print Format"));
	updateFormatSelect(select, printFormats, selectedFormat);

	const iframe = document.createElement("iframe");
	iframe.id = iframeId;
	iframe.style.width = "100%";
	iframe.style.height = "100%";
	iframe.style.border = "0";
	iframe.style.flex = "1";

	const footer = document.createElement("div");
	footer.style.padding = "12px";
	footer.style.borderTop = "1px solid #d1d8dd";
	footer.style.background = "#f7fafc";
	footer.style.display = "flex";
	footer.style.gap = "8px";
	footer.style.justifyContent = "flex-end";

	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.textContent = __("Close");
	closeButton.style.height = "36px";
	closeButton.style.padding = "0 16px";
	closeButton.style.border = "1px solid #d1d8dd";
	closeButton.style.borderRadius = "4px";
	closeButton.style.background = "#ffffff";
	closeButton.style.color = "#1f272e";
	closeButton.style.fontWeight = "600";
	closeButton.style.cursor = "pointer";

	const printButton = document.createElement("button");
	printButton.type = "button";
	printButton.textContent = __("Print");
	printButton.style.height = "36px";
	printButton.style.padding = "0 16px";
	printButton.style.border = "0";
	printButton.style.borderRadius = "4px";
	printButton.style.background = "#2490ef";
	printButton.style.color = "#ffffff";
	printButton.style.fontWeight = "600";
	printButton.style.cursor = "pointer";
	printButton.style.opacity = "0.6";
	printButton.disabled = true;

	const previewContainer = document.createElement("div");
	previewContainer.style.position = "relative";
	previewContainer.style.flex = "1";
	previewContainer.style.background = "#ffffff";

	const loader = document.createElement("div");
	loader.style.position = "absolute";
	loader.style.inset = "0";
	loader.style.display = "flex";
	loader.style.alignItems = "center";
	loader.style.justifyContent = "center";
	loader.style.background = "rgba(255, 255, 255, 0.92)";
	loader.style.zIndex = "1";

	const spinner = document.createElement("div");
	spinner.style.width = "32px";
	spinner.style.height = "32px";
	spinner.style.border = "3px solid #d1d8dd";
	spinner.style.borderTopColor = "#2490ef";
	spinner.style.borderRadius = "50%";
	spinner.style.animation = "posa-print-preview-spin 0.8s linear infinite";

	const styleId = "posa-print-preview-loader-style";
	if (!document.getElementById(styleId)) {
		const style = document.createElement("style");
		style.id = styleId;
		style.textContent =
			"@keyframes posa-print-preview-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
		document.head.appendChild(style);
	}

	loader.appendChild(spinner);
	previewContainer.appendChild(loader);
	previewContainer.appendChild(iframe);

	const loadPreview = async (printFormat) => {
		loader.style.display = "flex";
		printButton.disabled = true;
		printButton.style.opacity = "0.6";
		iframe.onload = () => {
			loader.style.display = "none";
			printButton.disabled = false;
			printButton.style.opacity = "1";

			// Cache print template here
			if (invoiceDoc && payload.doctype === "Sales Invoice" && !html) {
				try {
					const win = iframe.contentWindow;
					if (win) {
						const printHtml = win.document.documentElement.innerHTML;
						localStorage.setItem(`posa_print_template_html_${printFormat}`, printHtml);
						localStorage.setItem(
							`posa_print_template_doc_${printFormat}`,
							JSON.stringify(invoiceDoc),
						);
						console.log(`Cached print format template from preview for: ${printFormat}`);
					}
				} catch (e) {
					console.warn("Failed to cache template from preview iframe:", e);
				}
			}
		};
		iframe.onerror = () => {
			loader.style.display = "none";
			printButton.disabled = false;
			printButton.style.opacity = "1";
		};

		if (html) {
			const win = iframe.contentWindow;
			if (win) {
				win.document.open();
				win.document.write(html);
				win.document.close();
			}
		} else {
			const url = await buildURL({
				...payload,
				print_format: printFormat,
			});
			iframe.src = url;
		}
	};

	select.addEventListener("change", () => {
		if (payload.on_print_format_change) {
			payload.on_print_format_change(select.value);
		}
		loadPreview(select.value).catch((error) => {
			console.error("Unable to load print preview", error);
			frappe.msgprint(__("Unable to open print preview."));
		});
	});

	const cleanup = () => {
		document.removeEventListener("keydown", closeOnEscape);
		overlay.remove();
		emitter.emit("refocus_item_search");
	};
	const closeOnEscape = (event) => {
		if (event.key === "Escape") {
			cleanup();
		}
	};

	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) {
			cleanup();
		}
	});

	closeButton.addEventListener("click", () => {
		cleanup();
	});

	printButton.addEventListener("click", () => {
		try {
			const win = iframe.contentWindow;
			if (!win || win.closed) {
				throw new Error("Print iframe inaccessible");
			}
			win.focus();
			win.print();
			cleanup();
		} catch (error) {
			console.error("Unable to open print dialog", error);
			frappe.msgprint(__("Unable to open print dialog."));
		}
	});
	document.addEventListener("keydown", closeOnEscape);

	toolbar.appendChild(heading);
	toolbar.appendChild(select);
	panel.appendChild(toolbar);
	panel.appendChild(previewContainer);
	footer.appendChild(closeButton);
	footer.appendChild(printButton);
	panel.appendChild(footer);
	overlay.appendChild(panel);
	document.body.appendChild(overlay);

	await loadPreview(selectedFormat);
}

async function printSilently(payload, options = {}) {
	await showPrintPreview(payload, {
		overlayId: "posa-silent-print-preview",
		iframeId: "posa-silent-print-preview-frame",
		invoiceDoc: options.invoiceDoc,
	});
}

async function openDirectPrintPreview(payload, { buildURL, iframeId }, options = {}) {
	const url = await buildURL(payload);
	await openPrintDialogInHiddenIframe(url, {
		iframeId,
		onError: async (error) => {
			console.error("Unable to open direct print preview", error);
			frappe.msgprint(__("Unable to open print preview."));
		},
		invoiceDoc: options.invoiceDoc,
		printPayload: payload,
	});
}

export async function fallbackToOffline(invoiceDoc, usePreviewOverlay = false) {
	if (!invoiceDoc) return;
	try {
		let posProfile = null;
		try {
			const openingData = getOpeningStorage();
			if (openingData && openingData.pos_profile) {
				posProfile = openingData.pos_profile;
			}
		} catch (e) {
			console.warn("Failed to retrieve posProfile in print.js fallbackToOffline", e);
		}

		const html = await renderOfflineInvoiceHTML(invoiceDoc, posProfile);
		if (!html) return;

		const formatName = posProfile?.print_format_for_online || posProfile?.print_format || "Standard";

		if (usePreviewOverlay) {
			await showPrintPreview(
				{
					doctype: "Sales Invoice",
					name: invoiceDoc.name,
					print_format: formatName,
				},
				{
					overlayId: "posa-silent-print-preview",
					iframeId: "posa-silent-print-preview-frame",
					html: html,
				},
			);
		} else {
			await openPrintDialogInHiddenIframe("", {
				iframeId: "posa-silent-print-direct-frame",
				html: html,
				onError: async (error) => {
					console.error("Unable to open offline direct print", error);
				},
			});
		}
	} catch (error) {
		console.error("Offline print fallback failed", error);
	} finally {
		emitter.emit("refocus_item_search");
	}
}

export function silentPrint(payload, options = {}) {
	const printPayload = normalizePrintPayload(payload);
	if (!printPayload) return;
	const usePreviewOverlay = !!printPayload.use_print_preview_overlay || !!options.use_print_preview_overlay;
	const action = usePreviewOverlay
		? printSilently(printPayload, options)
		: openDirectPrintPreview(
				{ ...printPayload, trigger_print: true },
				{
					buildURL: generatePrintURL,
					iframeId: "posa-silent-print-direct-frame",
				},
				options,
			);
	Promise.resolve(action)
		.then(() => {
			emitter.emit("refocus_item_search");
		})
		.catch(async (error) => {
			console.error("Silent print failed, using offline fallback", error);
			await fallbackToOffline(options?.invoiceDoc, usePreviewOverlay);
			emitter.emit("refocus_item_search");
		});
}

export function multiSilentPrint(payload) {
	if (!payload || !Array.isArray(payload.names) || !payload.names.length) return;
	const usePreviewOverlay = !!payload.use_print_preview_overlay;
	const action = usePreviewOverlay
		? showPrintPreview(payload, {
				overlayId: "posa-payment-entry-multi-print-preview",
				iframeId: "posa-payment-entry-multi-print-frame",
				buildURL: generateMultiPrintURL,
			})
		: openDirectPrintPreview(payload, {
				buildURL: generateMultiPrintURL,
				iframeId: "posa-payment-entry-multi-direct-frame",
			});
	Promise.resolve(action)
		.then(() => {
			emitter.emit("refocus_item_search");
		})
		.catch((error) => {
			console.error("Multi print failed", error);
			frappe.msgprint(__("Unable to open print preview."));
			emitter.emit("refocus_item_search");
		});
}
export async function prefetchPrintTemplate(posProfile) {
	if (!navigator.onLine || !posProfile) return;

	const printFormat = posProfile.print_format_for_online || posProfile.print_format || "Standard";
	const noLetterhead = posProfile.letter_head ? 0 : 1;

	// Check if already cached
	const cachedHtml = localStorage.getItem(`posa_print_template_html_${printFormat}`);
	const cachedDoc = localStorage.getItem(`posa_print_template_doc_${printFormat}`);
	if (cachedHtml && cachedDoc) {
		console.log(`Print template for ${printFormat} is already cached.`);
		return;
	}

	console.log(`Pre-fetching print template for format: ${printFormat}`);
	try {
		// 1. Get the latest submitted Sales Invoice
		const response = await frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Sales Invoice",
				filters: { docstatus: 1, company: posProfile.company },
				fields: ["name"],
				limit_page_length: 1,
				order_by: "creation desc",
			},
		});

		if (!response.message || !response.message.length) {
			console.log("No submitted Sales Invoices found to use as print template.");
			return;
		}

		const invoiceName = response.message[0].name;

		// 2. Fetch the invoice document details
		const docResponse = await frappe.call({
			method: "frappe.client.get",
			args: {
				doctype: "Sales Invoice",
				name: invoiceName,
			},
		});

		if (!docResponse.message) return;
		const invoiceDoc = docResponse.message;

		// 3. Fetch the rendered print HTML
		const baseUrl = frappe.urllib.get_base_url();
		const params = new URLSearchParams({
			doctype: "Sales Invoice",
			name: invoiceName,
			format: printFormat,
			no_letterhead: String(noLetterhead),
			_: String(Date.now()),
		});

		const printViewUrl = `${baseUrl}/printview?${params.toString()}`;
		const fetchResponse = await fetch(printViewUrl);
		if (!fetchResponse.ok) throw new Error("Failed to fetch printview");

		const printHtml = await fetchResponse.text();

		// 4. Save to localStorage
		localStorage.setItem(`posa_print_template_html_${printFormat}`, printHtml);
		localStorage.setItem(`posa_print_template_doc_${printFormat}`, JSON.stringify(invoiceDoc));
		console.log(`Successfully pre-fetched and cached print template for ${printFormat}`);
	} catch (error) {
		console.error("Failed to pre-fetch print template:", error);
	}
}
