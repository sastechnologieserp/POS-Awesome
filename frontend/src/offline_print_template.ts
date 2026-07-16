import {
	getPrintTemplate,
	getTermsAndConditions,
	memoryInitPromise,
	getOpeningStorage,
} from "./offline/index";
import nunjucks from "nunjucks";

declare const frappe: any;

function normaliseTemplate(template: string) {
	if (!template) return template;
	return template.replace(/"""([\s\S]*?)"""/g, (_, str) => {
		const escaped = str
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\r?\n/g, "\\n");
		return `"${escaped}"`;
	});
}

function attachFormatter(obj: any) {
	if (!obj || typeof obj !== "object" || obj.get_formatted) return;
	obj.get_formatted = function (field: string) {
		return this?.[field];
	};
}

function computePaidAmount(doc: any) {
	if (!doc) return 0;

	const sign = doc.is_return ? -1 : 1;
	const paymentsTotal = (doc.payments || []).reduce(
		(sum: number, p: any) => sum + Math.abs(parseFloat(p.amount) || 0),
		0,
	);
	const changeAmount = Math.abs(parseFloat(doc.change_amount) || 0);

	const creditSale =
		doc.is_credit_sale === true ||
		doc.is_credit_sale === 1 ||
		doc.is_credit_sale === "1" ||
		String(doc.is_credit_sale).toLowerCase() === "yes";

	if (creditSale || paymentsTotal === 0) {
		return 0;
	}

	const paidAmount = paymentsTotal
		? Math.max(paymentsTotal - changeAmount, 0)
		: Math.abs(parseFloat(doc.paid_amount ?? doc.grand_total ?? 0) || 0);
	return sign * paidAmount;
}

function formatCurrency(amount: any, currency = "USD") {
	if (amount === null || amount === undefined) return "0.000";
	const num = parseFloat(amount);
	if (isNaN(num)) return "0.000";
	return Number(num).toFixed(3);
}

function defaultOfflineHTML(invoice: any, terms = "") {
	if (!invoice) return "";

	const itemsRows = (invoice.items || [])
		.map((it: any) => {
			const sn = it.serial_no
				? `<br><b>SR.No:</b><br>${it.serial_no.replace(/\n/g, ", ")}`
				: "";
			const nameMarker =
				invoice.posa_show_custom_name_marker_on_print && it.name_overridden
					? " (custom)"
					: "";
			const nameStr =
				it.item_name && it.item_name !== it.item_code
					? `<br>${it.item_name}${nameMarker}`
					: "";
			return `<tr>
				<td>${it.item_code}${nameStr}${sn}</td>
				<td class="text-right">${it.qty} ${it.uom || ""}<br>@ ${formatCurrency(it.rate, invoice.currency)}</td>
				<td class="text-right amount-cell">${formatCurrency(it.amount, invoice.currency)}</td>
			</tr>`;
		})
		.join("");

	const taxesRows = (invoice.taxes || [])
		.map(
			(row: any) => `<tr>
				<td class="text-right" style="width:70%">${row.description}@${row.rate}%</td>
				<td class="text-right amount-cell">${formatCurrency(row.tax_amount, invoice.currency)}</td>
			</tr>`,
		)
		.join("");

	const discountRow = invoice.discount_amount
		? `<tr>
				<td class="text-right" style="width:75%">Discount / تخفيض</td>
				<td class="text-right amount-cell">${formatCurrency(invoice.discount_amount, invoice.currency)}</td>
			</tr>`
		: "";

	const changeRow = invoice.change_amount
		? `<tr>
				<td class="text-right" style="width:75%">Change Amount / المبلغ المتبقي</td>
				<td class="text-right amount-cell">${formatCurrency(invoice.change_amount, invoice.currency)}</td>
			</tr>`
		: "";

	const qtyTotal = (invoice.items || []).reduce(
		(sum: number, item: any) => sum + (parseFloat(item.qty) || 0),
		0,
	);

	const formatDate = (dateStr: string) => {
		if (!dateStr) return "";
		const date = new Date(dateStr);
		return date.toLocaleDateString();
	};

	const paidAmount = computePaidAmount(invoice);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Invoice ${invoice.name || ""}</title>
	<style>
		.print-format table, .print-format tr,
		.print-format td, .print-format div, .print-format p {
			font-family: Monospace;
			line-height: 200%;
			vertical-align: middle;
		}
		@media screen {
			.print-format {
				width: 4in;
				padding: 0.25in;
				min-height: 8in;
			}
		}
		@media print {
			.print-format {
				width: 4in;
				padding: 0.25in;
				min-height: 8in;
			}
		}
		.text-right { text-align: right; }
		.text-center { text-align: center; }
		.table { width: 100%; border-collapse: collapse; }
		.table th, .table td { padding: 2px; }
		.no-border { border: none; }
		.cart { margin-bottom: 10px; }
		hr { border: none; border-top: 1px solid #ccc; margin: 10px 0; }
		.company-header { font-weight: bold; margin-bottom: 10px; }
		.customer-info { margin-bottom: 10px; }
		.items-table { margin-bottom: 15px; }
		.totals-table { margin-bottom: 10px; }
		.footer { margin-top: 15px; }
		.amount-cell { font-weight: bold; font-size: 11px; }
	</style>
</head>
<body class="print-format">
	<div class="company-header text-center">
		<b>${invoice.company || "Invoice"}</b><br>
		<small style="font-size: 10px;">نعم الطازج</small><br>
		POS No / رقم النقطة: ${invoice.pos_profile || "POS"}
	</div>
	
	<div class="customer-info">
		<p>
			<b>Customer / العميل:</b> ${invoice.customer_name || invoice.customer || ""}<br>
			<b>Mobile / الجوال:</b> ${invoice.contact_mobile || ""}<br>
			<b>Date / التاريخ:</b> ${formatDate(invoice.posting_date)}<br>
			<b>Time / الوقت:</b> ${invoice.posting_time || ""}<br>
			<b>Receipt No / رقم الإيصال:</b> ${invoice.name || ""}<br>
			<b>Status / الحالة:</b> ${invoice.status || ""}
		</p>
	</div>

	${invoice.posa_notes ? `<p><b>Additional Note / ملاحظة إضافية:</b> ${invoice.posa_notes}</p>` : ""}

	<hr>
	
	<div class="items-table">
		<table class="table table-condensed cart no-border">
			<thead>
				<tr>
					<th width="50%">Item / الصنف</th>
					<th width="25%" class="text-right">Qty / الكمية</th>
					<th width="25%" class="text-right">Amount / المبلغ</th>
				</tr>
			</thead>
			<tbody>${itemsRows}</tbody>
		</table>
	</div>

	<div class="totals-table">
		<table class="table table-condensed no-border">
			<tbody>
				<tr>
					<td class="text-right" style="width: 70%">
						Net Total / المجموع الصافي
					</td>
					<td class="text-right amount-cell">
						${formatCurrency(invoice.total ?? invoice.grand_total, invoice.currency)}
					</td>
				</tr>
				${taxesRows}
				${discountRow}
				<tr>
					<td class="text-right" style="width: 75%">
						<b>Grand Total / المجموع الإجمالي</b>
					</td>
					<td class="text-right amount-cell">
						${formatCurrency(invoice.grand_total, invoice.currency)}
					</td>
				</tr>
				<tr>
					<td class="text-right" style="width: 75%">
						<b>Paid Amount / المبلغ المدفوع</b>
					</td>
					<td class="text-right amount-cell">
						${formatCurrency(paidAmount, invoice.currency)}
					</td>
				</tr>
				${changeRow}
				<tr>
					<td class="text-right" style="width: 75%">
						<b>Qty Total / إجمالي الكمية</b>
					</td>
					<td class="text-right">
						${qtyTotal}
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<hr>
	<div class="footer">
		${terms ? `<p>${terms}</p>` : ""}
		<p class="text-center">Thank you, please visit again.<br>شكراً لك، يرجى زيارتنا مرة أخرى.</p>
	</div>
</body>
</html>`;
}

function renderOfflineTemplate(invoice: any, posProfile: any) {
	const printFormat = posProfile?.print_format_for_online || posProfile?.print_format || "Standard";
	const templateHtml = localStorage.getItem(`posa_print_template_html_${printFormat}`);
	const templateDocStr = localStorage.getItem(`posa_print_template_doc_${printFormat}`);

	if (!templateHtml || !templateDocStr) {
		console.log(`No cached print template found for ${printFormat}.`);
		return null;
	}

	try {
		const templateDoc = JSON.parse(templateDocStr);
		const parser = new DOMParser();
		const doc = parser.parseFromString(templateHtml, "text/html");

		// Helper to replace raw text nodes
		const replaceTextInDOM = (parent: any, searchStr: string | number, replaceStr: string | number) => {
			if (!searchStr) return;
			const search = String(searchStr).trim();
			const replace = String(replaceStr !== null && replaceStr !== undefined ? replaceStr : "").trim();
			if (!search) return;

			const walker = doc.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null);
			let node;
			while ((node = walker.nextNode())) {
				if (node.nodeValue && node.nodeValue.includes(search)) {
					node.nodeValue = node.nodeValue.split(search).join(replace);
				}
			}
		};

		// Helper to replace numeric values with boundary checks
		const replaceNumericValueInDOM = (parent: any, oldValue: number, newValue: number) => {
			if (oldValue === undefined || oldValue === null || oldValue === 0) return;

			const formats = [
				Number(oldValue).toFixed(3),
				Number(oldValue).toFixed(2),
				Number(oldValue).toFixed(0),
				String(oldValue),
			];

			const walker = doc.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null);
			let node;
			while ((node = walker.nextNode())) {
				const val = node.nodeValue;
				if (!val) continue;
				for (const fmt of formats) {
					const index = val.indexOf(fmt);
					if (index !== -1) {
						// Boundary check: ensure it is not part of a larger number
						const charBefore = index > 0 ? val[index - 1] : "";
						const charAfter =
							index + fmt.length < val.length
								? val[index + fmt.length]
								: "";

						const isDigitBefore = /\d/.test(charBefore);
						const isDigitAfter = /\d/.test(charAfter);

						if (!isDigitBefore && !isDigitAfter) {
							let newFmt = String(newValue);
							if (fmt.includes(".")) {
								const parts = fmt.split(".");
								const decimals = parts[1] ? parts[1].length : 0;
								newFmt = Number(newValue).toFixed(decimals);
							}
							node.nodeValue =
								val.substring(0, index) +
								newFmt +
								val.substring(index + fmt.length);
							break;
						}
					}
				}
			}
		};

		// 1. Replace metadata / details at the top/document level
		replaceTextInDOM(doc.body, templateDoc.name, invoice.name);
		replaceTextInDOM(
			doc.body,
			templateDoc.customer_name,
			invoice.customer_name || invoice.customer || "",
		);
		replaceTextInDOM(doc.body, templateDoc.customer, invoice.customer || "");

		if (templateDoc.posting_date) {
			const formatDateStr = (dateStr: string) => {
				if (!dateStr) return "";
				const date = new Date(dateStr);
				return date.toLocaleDateString();
			};
			replaceTextInDOM(
				doc.body,
				formatDateStr(templateDoc.posting_date),
				formatDateStr(invoice.posting_date),
			);
			replaceTextInDOM(doc.body, templateDoc.posting_date, invoice.posting_date);
		}

		if (templateDoc.posting_time) {
			replaceTextInDOM(doc.body, templateDoc.posting_time, invoice.posting_time || "");
		}

		// 2. Replace Items Table Rows
		if (templateDoc.items && templateDoc.items.length && invoice.items && invoice.items.length) {
			const firstItemCode = templateDoc.items[0].item_code;
			let templateRow: any = null;

			// Find row containing the first item code
			const rows = Array.from(doc.querySelectorAll("tr"));
			for (const tr of rows) {
				if (tr.textContent && tr.textContent.includes(firstItemCode)) {
					templateRow = tr;
					break;
				}
			}

			if (templateRow) {
				const parentTable = templateRow.parentNode;

				// Identify all rows representing items of the template invoice
				const itemRowsToDelete: any[] = [];
				for (const child of parentTable.children) {
					const hasItemCode = templateDoc.items.some((item: any) =>
						child.textContent && child.textContent.includes(item.item_code),
					);
					if (hasItemCode) {
						itemRowsToDelete.push(child);
					}
				}

				const rowTemplate = templateRow.cloneNode(true);

				// Generate new rows for the offline invoice
				invoice.items.forEach((newItem: any) => {
					const clonedRow = rowTemplate.cloneNode(true);
					const tempItem = templateDoc.items[0];

					// Replace values inside the cloned row
					replaceTextInDOM(clonedRow, tempItem.item_code, newItem.item_code);
					if (tempItem.item_name) {
						replaceTextInDOM(
							clonedRow,
							tempItem.item_name,
							newItem.item_name || newItem.item_code,
						);
					}

					replaceNumericValueInDOM(clonedRow, tempItem.qty, newItem.qty);
					replaceNumericValueInDOM(clonedRow, tempItem.rate, newItem.rate);
					replaceNumericValueInDOM(clonedRow, tempItem.amount, newItem.amount);

					// Insert before the original elements
					parentTable.insertBefore(clonedRow, itemRowsToDelete[0]);
				});

				// Clean up template invoice rows
				itemRowsToDelete.forEach((row) => row.remove());
			}
		}

		// 3. Replace Financial Totals
		const numericFields = ["total", "grand_total", "paid_amount", "change_amount", "discount_amount"];
		numericFields.forEach((field) => {
			const oldValue = templateDoc[field];
			const newValue = invoice[field];
			if (oldValue !== undefined && newValue !== undefined) {
				replaceNumericValueInDOM(doc.body, oldValue, newValue);
			}
		});

		return doc.documentElement.outerHTML;
	} catch (e) {
		console.error("Error rendering offline print template:", e);
		return null;
	}
}

export default async function renderOfflineInvoiceHTML(invoice: any) {
	if (!invoice) return "";

	await memoryInitPromise;

	// Try using dynamic DOM parsing on cached print template first (matching version-15)
	try {
		let posProfile = null;
		const openingData = getOpeningStorage();
		if (openingData && openingData.pos_profile) {
			posProfile = openingData.pos_profile;
		}
		if (posProfile) {
			const parsedHTML = renderOfflineTemplate(invoice, posProfile);
			if (parsedHTML) {
				return parsedHTML;
			}
		}
	} catch (e) {
		console.warn("Failed to render using cached template, falling back", e);
	}

	const template = normaliseTemplate(getPrintTemplate());
	const terms = getTermsAndConditions();
	const doc = {
		...invoice,
		terms: invoice.terms || terms,
		terms_and_conditions: invoice.terms_and_conditions || terms,
	};

	doc.paid_amount = computePaidAmount(doc);
	attachFormatter(doc);
	(doc.items || []).forEach(attachFormatter);
	(doc.taxes || []).forEach(attachFormatter);

	if (!template) {
		console.warn(
			"No offline print template cached; using fallback template",
		);
		return defaultOfflineHTML(doc, doc.terms_and_conditions);
	}

	try {
		const env = nunjucks.configure({ autoescape: false });
		env.addFilter("format_currency", (value: unknown, currency: string) => {
			const number =
				typeof value === "number" ? value : parseFloat(String(value));
			if (Number.isNaN(number)) return value;
			try {
				return new Intl.NumberFormat(undefined, {
					style: currency ? "currency" : "decimal",
					currency: currency || undefined,
				}).format(number);
			} catch {
				return currency ? `${currency} ${number}` : String(number);
			}
		});
		env.addFilter("currency", (value: unknown, currency: string) =>
			(env as any).filters.format_currency(value, currency),
		);
		(env as any).getFilter = function (name: string) {
			return (this as any).filters[name] || ((v: unknown) => v);
		};

		const context = {
			doc,
			terms: doc.terms,
			terms_and_conditions: doc.terms_and_conditions,
			_: frappe?._ ? frappe._ : (t: string) => t,
			frappe: {
				db: { get_value: () => "", sql: () => [] },
				get_list: () => [],
			},
		};
		return env.renderString(template, context);
	} catch (e) {
		console.error("Failed to render offline invoice", e);
		return defaultOfflineHTML(doc, doc.terms_and_conditions);
	}
}
