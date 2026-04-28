import renderOfflineInvoiceHTML from "../../offline_print_template";

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
	{ iframeId = `posa-print-frame-${Date.now()}`, cleanupDelay = 60000, onError } = {},
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

		iframe.src = url;
		document.body.appendChild(iframe);
	});
}

async function showPrintPreview(
	payload,
	{
		overlayId = "posa-print-preview",
		iframeId = "posa-print-preview-frame",
		buildURL = generatePrintURL,
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
	footer.style.justifyContent = "flex-end";

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
		};
		iframe.onerror = () => {
			loader.style.display = "none";
			printButton.disabled = false;
			printButton.style.opacity = "1";
		};
		const url = await buildURL({
			...payload,
			print_format: printFormat,
		});
		iframe.src = url;
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

	printButton.addEventListener("click", () => {
		try {
			const win = iframe.contentWindow;
			if (!win || win.closed) {
				throw new Error("Print iframe inaccessible");
			}
			win.focus();
			win.print();
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
	footer.appendChild(printButton);
	panel.appendChild(footer);
	overlay.appendChild(panel);
	document.body.appendChild(overlay);

	await loadPreview(selectedFormat);
}

async function printSilently(payload) {
	await showPrintPreview(
		payload,
		{ overlayId: "posa-silent-print-preview", iframeId: "posa-silent-print-preview-frame" },
	);
}

async function openDirectPrintPreview(payload, { buildURL, iframeId }) {
	const url = await buildURL(payload);
	await openPrintDialogInHiddenIframe(url, {
		iframeId,
		onError: async (error) => {
			console.error("Unable to open direct print preview", error);
			frappe.msgprint(__("Unable to open print preview."));
		},
	});
}

async function fallbackToOffline(invoiceDoc) {
	if (!invoiceDoc) return;
	try {
		const html = await renderOfflineInvoiceHTML(invoiceDoc);
		if (!html) return;

		const target = window.open("", "_blank", "noopener,noreferrer");
		if (!target) return;

		target.document.open();
		target.document.write(html);
		target.document.close();
		target.focus();
		target.print();
	} catch (error) {
		console.error("Offline print fallback failed", error);
	}
}

export function silentPrint(payload, options = {}) {
	const printPayload = normalizePrintPayload(payload);
	if (!printPayload) return;
	const usePreviewOverlay =
		!!printPayload.use_print_preview_overlay || !!options.use_print_preview_overlay;
	const action = usePreviewOverlay
		? printSilently(printPayload)
		: openDirectPrintPreview(
				{ ...printPayload, trigger_print: true },
				{
					buildURL: generatePrintURL,
					iframeId: "posa-silent-print-direct-frame",
				},
			);
	Promise.resolve(action).catch(async (error) => {
		console.error("Silent print failed, using offline fallback", error);
		await fallbackToOffline(options?.invoiceDoc);
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
	Promise.resolve(action).catch((error) => {
		console.error("Multi print failed", error);
		frappe.msgprint(__("Unable to open print preview."));
	});
}
