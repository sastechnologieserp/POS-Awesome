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

async function printSilently({ doctype, name, print_format, no_letterhead }, options = {}) {
	const url = await generatePrintURL({ doctype, name, print_format, no_letterhead });
	const iframe = document.createElement("iframe");
	iframe.style.position = "fixed";
	iframe.style.right = "0";
	iframe.style.bottom = "0";
	iframe.style.width = "0";
	iframe.style.height = "0";
	iframe.style.border = "0";

	const cleanup = () => setTimeout(() => iframe.remove(), 1000);

	iframe.onload = async () => {
		try {
			const win = iframe.contentWindow;
			if (!win || win.closed) {
				throw new Error("Print iframe inaccessible");
			}
			win.focus();
			win.print();
		} catch (error) {
			await fallbackToOffline(options?.invoiceDoc);
		} finally {
			cleanup();
		}
	};

	iframe.onerror = async () => {
		await fallbackToOffline(options?.invoiceDoc);
		cleanup();
	};

	iframe.src = url;
	document.body.appendChild(iframe);
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
