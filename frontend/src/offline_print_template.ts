import {
	getPrintTemplate,
	getTermsAndConditions,
	memoryInitPromise,
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

export default async function renderOfflineInvoiceHTML(invoice: any) {
	if (!invoice) return "";

	await memoryInitPromise;

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
