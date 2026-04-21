import renderOfflineInvoiceHTML from "../../offline_print_template";

async function generatePrintURL({ doctype, name, print_format, no_letterhead }) {
	const baseUrl = frappe.urllib.get_base_url();
	const params = new URLSearchParams({
		doctype,
		name,
		trigger_print: "1",
		format: print_format,
		no_letterhead: String(no_letterhead),
		_: String(Date.now()),
	});
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

async function printURLInHiddenIframe(
	url,
	{ iframeId = `posa-print-frame-${Date.now()}`, cleanupDelay = 1000, onError } = {},
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

async function printSilently({ doctype, name, print_format, no_letterhead }, options = {}) {
	const url = await generatePrintURL({ doctype, name, print_format, no_letterhead });
	await printURLInHiddenIframe(url, {
		onError: async () => {
			await fallbackToOffline(options?.invoiceDoc);
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
	if (!payload) return;
	printSilently(payload, options).catch(async (error) => {
		console.error("Silent print failed, using offline fallback", error);
		await fallbackToOffline(options?.invoiceDoc);
	});
}

export function multiSilentPrint(payload) {
	if (!payload || !Array.isArray(payload.names) || !payload.names.length) return;
	generateMultiPrintURL(payload)
		.then((url) =>
			printURLInHiddenIframe(url, {
				iframeId: "posa-payment-entry-multi-print-frame",
				cleanupDelay: 60000,
				onError: async (error) => {
					console.error("Unable to open multi print preview", error);
					frappe.msgprint(__("Unable to open print preview."));
				},
			}),
		)
		.catch((error) => {
			console.error("Multi silent print failed", error);
			frappe.msgprint(__("Unable to open print preview."));
		});
}
