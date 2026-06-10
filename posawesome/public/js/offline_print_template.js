export default function generateOfflineInvoiceHTML(invoice, posProfile = null, customFormat = null) {
	if (!invoice) return "";

	// Calculate paid amount from payments if not already set
	if (!invoice.paid_amount && invoice.payments && Array.isArray(invoice.payments)) {
		invoice.paid_amount = invoice.payments.reduce((total, payment) => {
			return total + (parseFloat(payment.amount) || 0);
		}, 0);
		console.log('Calculated paid_amount from payments:', invoice.paid_amount);
	}

	// Calculate change_amount if paid_amount > grand_total and not already set
	if (!invoice.change_amount && invoice.paid_amount && invoice.grand_total) {
		const paid = parseFloat(invoice.paid_amount) || 0;
		const grand = parseFloat(invoice.grand_total) || 0;
		if (paid > grand) {
			invoice.change_amount = paid - grand;
			console.log('Calculated change_amount:', invoice.change_amount);
		}
	}

	const companyName = posProfile?.company || invoice.company;
	const posNumber = posProfile?.name || invoice.pos_profile || "POS";
	const letterHead = posProfile?.letter_head;
	const terms = posProfile?.tc_name || invoice.terms || "";

	if (customFormat && typeof customFormat === 'function') {
		return customFormat(invoice, posProfile);
	}

	const printFormat = posProfile?.print_format;

	// Debug logging
	console.log('POS Profile:', posProfile);
	console.log('Print Format from POS Profile:', printFormat);
	console.log('Invoice:', invoice);

	// TEMPORARY TEST: Force custom format for testing
	// Remove this after testing
	const forceCustomFormat = true; // Set to false to disable

	if (forceCustomFormat) {
		console.log('TEST MODE: Forcing custom POS Print format');
		return generatePOSPrintFormat(invoice, posProfile);
	}

	// Check for any print format configuration
	if (printFormat) {
		console.log('Using custom POS Print format');
		return generatePOSPrintFormat(invoice, posProfile);
	}

	console.log('Using default format');

	const itemsRows = (invoice.items || [])
		.map((it) => {
			const sn = it.serial_no ? `<br><b>SR.No:</b><br>${it.serial_no.replace(/\n/g, ", ")}` : "";
			return `<tr>
        <td>${it.item_code}${it.item_name && it.item_name !== it.item_code ? `<br>${it.item_name}` : ""}${sn}</td>
        <td class="text-right">${it.qty} ${it.uom || ""}<br>@ ${formatCurrency(it.rate, invoice.currency)}</td>
        <td class="text-right amount-cell">${formatCurrency(it.amount, invoice.currency)}</td>
      </tr>`;
		})
		.join("");

	const taxesRows = (invoice.taxes || [])
		.map(
			(row) => `<tr>
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

	const qtyTotal = (invoice.items || []).reduce((sum, item) => sum + (parseFloat(item.qty) || 0), 0);

	const formatDate = (dateStr) => {
		if (!dateStr) return "";
		const date = new Date(dateStr);
		return date.toLocaleDateString();
	};

	const html = `<!DOCTYPE html>
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
      ${companyName}<br>
      POS No / رقم النقطة: ${posNumber}
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
              ${formatCurrency(invoice.total, invoice.currency)}
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
              ${formatCurrency(invoice.paid_amount, invoice.currency)}
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
	return html;
}

function generatePOSPrintFormat(invoice, posProfile) {
	// Calculate paid amount from payments if not already set
	if (!invoice.paid_amount && invoice.payments && Array.isArray(invoice.payments)) {
		invoice.paid_amount = invoice.payments.reduce((total, payment) => {
			return total + (parseFloat(payment.amount) || 0);
		}, 0);
		console.log('POS Print - Calculated paid_amount from payments:', invoice.paid_amount);
	}

	// Calculate change_amount if paid_amount > grand_total and not already set
	if (!invoice.change_amount && invoice.paid_amount && invoice.grand_total) {
		const paid = parseFloat(invoice.paid_amount) || 0;
		const grand = parseFloat(invoice.grand_total) || 0;
		if (paid > grand) {
			invoice.change_amount = paid - grand;
			console.log('POS Print - Calculated change_amount:', invoice.change_amount);
		}
	}

	const formatDate = (dateStr) => {
		if (!dateStr) return "";
		const date = new Date(dateStr);
		return date.toLocaleDateString();
	};

	const formatTime = (timeStr) => {
		if (!timeStr) return "";
		return timeStr;
	};

	const itemsRows = (invoice.items || [])
		.map((item) => {
			const barcode = item.barcode || item.item_code || "";

			return `
				<tr>
					<td colspan="4" style="font-weight: bold;">${item.item_name || item.item_code}</td>
				</tr>
				<tr>
					<td style="font-size: 9px;">${barcode}</td>
					<td style="text-align: center;">${item.qty}</td>
					<td style="text-align: right; font-weight: bold; font-size: 11px;">${formatCurrency(item.rate, invoice.currency)}</td>
					<td style="text-align: right; font-weight: bold; font-size: 11px;">${formatCurrency(item.amount, invoice.currency)}</td>
				</tr>
			`;
		})
		.join("");

	const paymentMethods = (invoice.payments || [])
		.map((payment) => `Payment Method: ${payment.mode_of_payment}`)
		.join('<br>');

	const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Invoice ${invoice.name || ""}</title>
	<style>
		@import url('http://fonts.cdnfonts.com/css/vcr-osd-mono');
		body {
			font-family: 'VCR OSD Mono';
			color: #000;
			text-align: center;
			display: flex;
			justify-content: center;
			font-size: 10px;
			margin: 0;
			padding: 0;
			min-height: 100vh;
		}
		.address {
			line-height: 100%;
		}
		.brand {
			font-size: 20px;
		}
		.print-format td, .print-format th {
			padding: 3px !important;
		}
		.address {
			margin-top: 0px;
		}
		.bill {
			width: 80mm;
			margin: 0 auto;
			box-shadow: 0 0 3px #aaa;
			padding: 5px;
			box-sizing: border-box;
			min-height: auto;
		}
		.flex {
			display: flex;
		}
		.justify-between {
			justify-content: space-between;
		}
		.table {
			border-collapse: collapse;
			width: 100%;
		}
		.table .header {
			border-top: 3px dashed #000;
			border-bottom: 3px dashed #000;
		}
		th {
			color: black !important;
		}
		td {
			color: black !important;
		}
		.table {
			text-align: left;
		}
		.table .total td {
			border-top: 2px dashed #000;
			border-bottom: 2px dashed #000;
		}
		.table .net-amount td:first-of-type {
			border-top: none;
		}
		.table .net-amount td {
			border-top: 2px dashed #000;
		}
		.table .net-amount {
			border-bottom: 2px dashed #000;
		}
		.amount-column {
			text-align: right;
			padding-right: 5px;
			font-weight: bold;
			font-size: 11px;
		}
		.table td {
			vertical-align: top;
			padding: 2px 3px;
		}
		.table th {
			padding: 3px;
			font-weight: bold;
		}
		.brand {
			margin-bottom: 10px;
		}
		.brand b {
			font-size: 18px;
		}
		.brand small {
			font-size: 12px;
		}
		@media print {
			.hidden-print,
			.hidden-print * {
				display: none !important;
			}
			body {
				margin: 0;
				padding: 0;
				min-height: auto;
			}
			.bill {
				margin: 0;
				box-shadow: none;
				width: 80mm;
				height: auto;
				padding: 2mm;
			}
			@page {
				size: 80mm auto;
				margin: 0;
			}
		}
	</style>
</head>
<body>
	<div class="bill">
		<div class="brand">
			<b>${invoice.company}</b><br>
			<small style="font-size: 10px;">نعم الطازج</small>
		</div>
		<div class="address">
		</div>
		${invoice.status === 'Paid' ?
			'<div class="invoice"><b> INVOICE</b></div>' :
			'<div class="invoice"><b> INVOICE</b></div>'
		}
		<div class="bill-details">
			<div class="flex justify-between">
				<div>Invoice No: ${invoice.name || ""}</div>
			</div>
			<div class="flex justify-between">
				<div>Date: ${formatDate(invoice.posting_date)}</div>
				<div>Time: ${formatTime(invoice.posting_time)}</div>
			</div>
		</div>
		<table class="table" width="100%">
			<tr class="header">
				<th width="35%" class="td2">
					Item &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
					الإ سم
				</th>
				<th width="20%" class="td2">
					Qty &nbsp;
					الكمية
				</th>
				<th width="20%" class="td2">
					U/P &nbsp; &nbsp;
					س\ و
				</th>
				<th width="25%" class="td2">
					Amount
					المجموع
				</th>
			</tr>
			${itemsRows}
		</table>
		<table class="table" width="100%">
			<tr class="total">
				<td width="35%">Total</td>
				<td width="40%">المجموع</td>
				<td width="25%" class="amount-column">${formatCurrency(invoice.total, invoice.currency)}</td>
			</tr>
			${invoice.discount_amount && parseFloat(invoice.discount_amount) > 0 ? `
			<tr>
				<td>Discount</td>
				<td>تخفيض</td>
				<td class="amount-column">${formatCurrency(invoice.discount_amount, invoice.currency)}</td>
			</tr>
			` : ""}
			<tr class="net-amount">
				<td>Net Amount</td>
				<td>المجموع الإجمالي</td>
				<td class="amount-column">${formatCurrency(invoice.grand_total, invoice.currency)}</td>
			</tr>
			<tr>
				<td>Paid Amount</td>
				<td>المبلغ المدفوع</td>
				<td class="amount-column">${formatCurrency(invoice.paid_amount, invoice.currency)}</td>
			</tr>
			${(parseFloat(invoice.paid_amount) > parseFloat(invoice.grand_total)) ? `
			<tr class="net-amount">
				<td colspan="3" style="font-size:16px; text-align: center;"><b>Change Amount: ${formatCurrency(parseFloat(invoice.paid_amount) - parseFloat(invoice.grand_total), invoice.currency)}</b></td>
			</tr>
			` : ""}
		</table>
		
		${paymentMethods}<br>
		Username: ${posProfile?.name || "POS"} [Biller]<br>
		Thank You ! Please visit again<br><br>
		<div style="text-align: center; font-weight: bold; margin-top: 10px;">
			END OF RECEIPT
		</div>
	</div>
</body>
</html>`;

	return html;
}

function formatCurrency(amount, currency = "USD") {
	if (amount === null || amount === undefined) return "0.000";
	const num = parseFloat(amount);
	if (isNaN(num)) return "0.000";
	// Force 3 decimal places
	return Number(num).toFixed(3);
}

export { formatCurrency };
