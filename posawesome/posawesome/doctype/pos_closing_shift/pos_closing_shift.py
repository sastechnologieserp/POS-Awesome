# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
import json
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class POSClosingShift(Document):
	def validate(self):
		user = frappe.get_all(
			"POS Closing Shift",
			filters={
				"user": self.user,
				"docstatus": 1,
				"pos_opening_shift": self.pos_opening_shift,
				"name": ["!=", self.name],
			},
		)

		if user:
			frappe.throw(
				_(
					"POS Closing Shift {} against {} between selected period".format(
						frappe.bold("already exists"), frappe.bold(self.user)
					)
				),
				title=_("Invalid Period"),
			)

		if frappe.db.get_value("POS Opening Shift", self.pos_opening_shift, "status") != "Open":
			frappe.throw(
				_("Selected POS Opening Shift should be open."),
				title=_("Invalid Opening Entry"),
			)
		self.update_payment_reconciliation()

	def update_payment_reconciliation(self):
		# update the difference values in Payment Reconciliation child table
		# get default precision for site
		precision = frappe.get_cached_value("System Settings", None, "currency_precision") or 3
		for d in self.payment_reconciliation:
			d.difference = flt(d.closing_amount, precision) - flt(d.expected_amount, precision)
		
		# Update credit sales information
		self.update_credit_sales_info()

	def update_credit_sales_info(self):
		"""
		Update credit sales total and populate credit sales details from unpaid invoices
		"""
		if self.pos_opening_shift:
			unpaid_invoices = get_unpaid_invoices(self.pos_opening_shift)
			credit_sales_total = 0
			
			# Clear existing credit sales details
			self.credit_sales_details = []
			
			for invoice in unpaid_invoices:
				credit_sales_total += flt(invoice.outstanding_amount)
				
				# Add to credit sales details child table
				self.append("credit_sales_details", {
					"sales_invoice": invoice.name,
					"customer": invoice.customer,
					"customer_name": invoice.get("customer_name", ""),
					"outstanding_amount": flt(invoice.outstanding_amount)
				})
			
			self.credit_sales_total = credit_sales_total

	def on_submit(self):
		opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
		opening_entry.pos_closing_shift = self.name
		opening_entry.set_status()
		self.delete_draft_invoices()
		opening_entry.save()

	def on_cancel(self):
		if frappe.db.exists("POS Opening Shift", self.pos_opening_shift):
			opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
			if opening_entry.pos_closing_shift == self.name:
				opening_entry.pos_closing_shift = ""
				opening_entry.set_status()
				opening_entry.save()

	def delete_draft_invoices(self):
		if frappe.get_value("POS Profile", self.pos_profile, "posa_allow_delete"):
			data = frappe.db.sql(
				"""
                select
                    name
                from
                    `tabSales Invoice`
                where
                    docstatus = 0 and posa_is_printed = 0 and posa_pos_opening_shift = %s
                """,
				(self.pos_opening_shift),
				as_dict=1,
			)

			for invoice in data:
				frappe.delete_doc("Sales Invoice", invoice.name, force=1)

	@frappe.whitelist()
	def get_payment_reconciliation_details(self):
		currency = frappe.get_cached_value("Company", self.company, "default_currency")
		try:
			return frappe.render_template(
				"posawesome/posawesome/posawesome/doctype/pos_closing_shift/closing_shift_details.html",
				{"data": self, "currency": currency},
			)
		except Exception as e:
			return self._generate_fallback_html(currency)
	def _generate_fallback_html(self, currency):
		"""Generate fallback HTML if template fails to load"""
		html = f"""
		<div class="clearfix"></div>
		<div class="box">
			<div class="grid-body">
				<div class="rows text-center">
					<!-- Mode of payment section -->
					<div>
						<h6 class="text-center uppercase" style="color: #8D99A6">Mode of Payments</h6>
						<div class="tax-break-up" style="overflow-x: auto;">
							<table class="table table-bordered table-hover">
								<thead>
									<tr>
										<th class="text-left">Mode of Payment</th>
										<th class="text-right">Amount</th>
									</tr>
								</thead>
								<tbody>
		"""
		
		for payment in self.payment_reconciliation:
			amount = payment.expected_amount - payment.opening_amount
			html += f"""
									<tr>
										<td class="text-left">{payment.mode_of_payment}</td>
										<td class='text-right'> {frappe.utils.fmt_money(amount, currency=currency)}</td>
									</tr>
			"""
		
		html += """
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
		</div>
		"""
		return html

	@frappe.whitelist()
	def refresh_credit_sales(self):
		"""
		Refresh credit sales information from unpaid invoices
		"""
		self.update_credit_sales_info()
		self.save()
		return {
			"credit_sales_total": self.credit_sales_total,
			"unpaid_invoices_count": self.unpaid_invoices_count
		}

	@frappe.whitelist()
	def get_credit_sales_info(self):
		"""
		Get credit sales information for this closing shift
		"""
		if not self.credit_sales_total or not self.unpaid_invoices_count:
			self.update_credit_sales_info()
		
		return {
			"credit_sales_total": self.credit_sales_total or 0,
			"unpaid_invoices_count": self.unpaid_invoices_count or 0,
			"unpaid_invoices": get_unpaid_invoices(self.pos_opening_shift) if self.pos_opening_shift else []
		}


@frappe.whitelist()
def get_cashiers(doctype, txt, searchfield, start, page_len, filters):
	cashiers_list = frappe.get_all("POS Profile User", filters=filters, fields=["user"])
	result = []
	for cashier in cashiers_list:
		user_email = frappe.get_value("User", cashier.user, "email")
		if user_email:
			# Return list of tuples in format (value, label) where value is user ID and label shows both ID and email
			result.append([cashier.user, f"{cashier.user} ({user_email})"])
	return result


@frappe.whitelist()
def get_pos_invoices(pos_opening_shift):
	submit_printed_invoices(pos_opening_shift)
	# Fetch only submitted invoices (remove Draft invoices from closing shift report)
	data = frappe.db.sql(
		"""
		select
			name
		from
			`tabSales Invoice`
		where
			posa_pos_opening_shift = %s
			and docstatus = 1
		""",
		(pos_opening_shift),
		as_dict=1,
	)

	data = [frappe.get_doc("Sales Invoice", d.name).as_dict() for d in data]

	return data


@frappe.whitelist()
def get_payments_entries(pos_opening_shift):
	return frappe.get_all(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"reference_no": pos_opening_shift,
			"payment_type": "Receive",
		},
		fields=[
			"name",
			"mode_of_payment",
			"paid_amount",
			"reference_no",
			"posting_date",
			"party",
		],
	)


@frappe.whitelist()
def get_unpaid_invoices(pos_opening_shift):
	"""
	Get unpaid invoices (credit sales) for a specific POS shift
	"""
	if not pos_opening_shift:
		return []
	
	# Get all invoices for this POS shift first
	# Get unpaid invoices for this shift directly with SQL filter
	unpaid_invoices = frappe.db.sql(
		"""
		select
			name,
			grand_total,
			outstanding_amount,
			customer,
			customer_name,
			posting_date,
			docstatus
		from
			`tabSales Invoice`
		where
			posa_pos_opening_shift = %s
			and docstatus = 1
			and outstanding_amount > 0
		""",
		(pos_opening_shift),
		as_dict=1,
	)
	return unpaid_invoices


@frappe.whitelist()
def get_overdue_invoices(pos_opening_shift):
	"""
	Get overdue invoices for a specific POS shift
	"""
	if not pos_opening_shift:
		return []
	
	# Get overdue invoices for this shift
	overdue_invoices = frappe.db.sql(
		"""
		select
			name,
			grand_total,
			outstanding_amount,
			customer,
			customer_name,
			posting_date,
			status,
			docstatus
		from
			`tabSales Invoice`
		where
			posa_pos_opening_shift = %s
			and docstatus = 1
			and outstanding_amount > 0
			and (status = 'Overdue' or status = 'Overdue and Discounted')
		""",
		(pos_opening_shift),
		as_dict=1,
	)
	return overdue_invoices


@frappe.whitelist()
def get_closing_shift_credit_sales(closing_shift_name):
	"""
	Get credit sales information for a specific POS Closing Shift
	"""
	if not frappe.db.exists("POS Closing Shift", closing_shift_name):
		return {"error": "POS Closing Shift not found"}
	
	closing_shift_doc = frappe.get_doc("POS Closing Shift", closing_shift_name)
	
	# Get unpaid invoices for this shift
	unpaid_invoices = get_unpaid_invoices(closing_shift_doc.pos_opening_shift) if closing_shift_doc.pos_opening_shift else []
	
	# Calculate credit sales total
	credit_sales_total = sum(flt(invoice.outstanding_amount) for invoice in unpaid_invoices)
	unpaid_invoices_count = len(unpaid_invoices)
	
	return {
		"closing_shift_name": closing_shift_name,
		"credit_sales_total": credit_sales_total,
		"unpaid_invoices_count": unpaid_invoices_count,
		"unpaid_invoices": unpaid_invoices,
		"pos_opening_shift": closing_shift_doc.pos_opening_shift,
		"user": closing_shift_doc.user,
		"company": closing_shift_doc.company
	}


@frappe.whitelist()
def check_invoice_outstanding(invoice_name):
	"""
	Check the outstanding amount for a specific invoice
	"""
	if not frappe.db.exists("Sales Invoice", invoice_name):
		return {"error": "Invoice not found"}
	
	invoice_doc = frappe.get_doc("Sales Invoice", invoice_name)
	
	return {
		"invoice_name": invoice_name,
		"grand_total": invoice_doc.grand_total,
		"outstanding_amount": invoice_doc.outstanding_amount,
		"paid_amount": invoice_doc.paid_amount,
		"pos_opening_shift": getattr(invoice_doc, 'posa_pos_opening_shift', None),
		"docstatus": invoice_doc.docstatus,
		"customer": invoice_doc.customer
	}


@frappe.whitelist()
def test_credit_sales_simple(closing_shift_name):
	"""
	Simple test function to check credit sales data
	"""
	if not frappe.db.exists("POS Closing Shift", closing_shift_name):
		return {"error": "POS Closing Shift not found"}
	
	closing_shift_doc = frappe.get_doc("POS Closing Shift", closing_shift_name)
	
	# Get all invoices for this shift
	all_invoices = frappe.db.sql(
		"""
		select name, grand_total, outstanding_amount, customer, docstatus
		from `tabSales Invoice`
		where posa_pos_opening_shift = %s
		""",
		(closing_shift_doc.pos_opening_shift),
		as_dict=1,
	)
	
	# Get unpaid invoices
	unpaid_invoices = get_unpaid_invoices(closing_shift_doc.pos_opening_shift)
	
	return {
		"closing_shift": closing_shift_name,
		"pos_opening_shift": closing_shift_doc.pos_opening_shift,
		"all_invoices": all_invoices,
		"unpaid_invoices": unpaid_invoices,
		"total_outstanding": sum(flt(inv.outstanding_amount) for inv in unpaid_invoices)
	}


@frappe.whitelist()
def debug_credit_sales_data(closing_shift_name):
	"""
	Debug function to check credit sales data for a specific closing shift
	"""
	if not frappe.db.exists("POS Closing Shift", closing_shift_name):
		return {"error": "POS Closing Shift not found"}
	
	closing_shift_doc = frappe.get_doc("POS Closing Shift", closing_shift_name)
	
	# Get all invoices for this shift
	all_invoices = frappe.db.sql(
		"""
		select
			name,
			grand_total,
			outstanding_amount,
			customer,
			posting_date,
			docstatus
		from
			`tabSales Invoice`
		where
			posa_pos_opening_shift = %s
		""",
		(closing_shift_doc.pos_opening_shift),
		as_dict=1,
	)
	
	# Get unpaid invoices
	unpaid_invoices = get_unpaid_invoices(closing_shift_doc.pos_opening_shift)
	
	return {
		"closing_shift_name": closing_shift_name,
		"pos_opening_shift": closing_shift_doc.pos_opening_shift,
		"all_invoices_count": len(all_invoices),
		"all_invoices": all_invoices,
		"unpaid_invoices_count": len(unpaid_invoices),
		"unpaid_invoices": unpaid_invoices,
		"total_outstanding": sum(flt(inv.outstanding_amount) for inv in unpaid_invoices)
	}


@frappe.whitelist()
def get_credit_sales_summary(filters=None):
	"""
	Get credit sales summary for multiple closing shifts based on filters
	"""
	if not filters:
		filters = {}
	
	# Build the base query
	base_filters = {"docstatus": 1}  # Only submitted closing shifts
	
	# Add date filters if provided
	if filters.get("from_date"):
		base_filters["period_start_date"] = [">=", filters.get("from_date")]
	if filters.get("to_date"):
		base_filters["period_end_date"] = ["<=", filters.get("to_date")]
	if filters.get("user"):
		base_filters["user"] = filters.get("user")
	if filters.get("company"):
		base_filters["company"] = filters.get("company")
	
	# Get closing shifts
	closing_shifts = frappe.get_all(
		"POS Closing Shift",
		filters=base_filters,
		fields=["name", "user", "company", "period_start_date", "period_end_date", "pos_opening_shift"]
	)
	
	summary_data = []
	total_credit_sales = 0
	total_unpaid_count = 0
	
	for shift in closing_shifts:
		# Get credit sales for this shift
		credit_sales_info = get_closing_shift_credit_sales(shift.name)
		
		if "error" not in credit_sales_info:
			summary_data.append({
				"closing_shift_name": shift.name,
				"user": shift.user,
				"company": shift.company,
				"period_start_date": shift.period_start_date,
				"period_end_date": shift.period_end_date,
				"credit_sales_total": credit_sales_info["credit_sales_total"],
				"unpaid_invoices_count": credit_sales_info["unpaid_invoices_count"]
			})
			
			total_credit_sales += credit_sales_info["credit_sales_total"]
			total_unpaid_count += credit_sales_info["unpaid_invoices_count"]
	
	return {
		"shifts": summary_data,
		"total_credit_sales": total_credit_sales,
		"total_unpaid_count": total_unpaid_count,
		"total_shifts": len(summary_data)
	}


@frappe.whitelist()
def make_closing_shift_from_opening(opening_shift):
	opening_shift = json.loads(opening_shift)
	submit_printed_invoices(opening_shift.get("name"))
	closing_shift = frappe.new_doc("POS Closing Shift")
	closing_shift.pos_opening_shift = opening_shift.get("name")
	closing_shift.period_start_date = opening_shift.get("period_start_date")
	closing_shift.period_end_date = frappe.utils.get_datetime()
	closing_shift.pos_profile = opening_shift.get("pos_profile")
	closing_shift.user = opening_shift.get("user")
	closing_shift.company = opening_shift.get("company")
	closing_shift.grand_total = 0
	closing_shift.net_total = 0
	closing_shift.total_quantity = 0
	closing_shift.credit_sales_total = 0
	closing_shift.overdue_sales_total = 0

	invoices = get_pos_invoices(opening_shift.get("name"))
	
	# Get unpaid invoices for credit sales
	unpaid_invoices = get_unpaid_invoices(opening_shift.get("name"))
	
	# Get overdue invoices
	overdue_invoices = get_overdue_invoices(opening_shift.get("name"))
	
	# Get return sales for this shift
	return_sales_data = get_sales_returns_for_shift(opening_shift.get("name"))
	
	# Add return sales data to closing shift
	closing_shift.return_sales_total = return_sales_data.get('returns_total', 0)
	closing_shift.return_sales_count = return_sales_data.get('returns_count', 0)

	pos_transactions = []
	taxes = []
	payments = []
	pos_payments_table = []
	credit_sales_list = []
	
	for detail in opening_shift.get("balance_details"):
		payments.append(
			frappe._dict(
				{
					"mode_of_payment": detail.get("mode_of_payment"),
					"opening_amount": detail.get("amount") or 0,
					"expected_amount": detail.get("amount") or 0,
				}
			)
		)
	
	# Populate credit sales details
	for unpaid_invoice in unpaid_invoices:
		credit_sales_list.append(
			frappe._dict(
				{
					"sales_invoice": unpaid_invoice.name,
					"customer": unpaid_invoice.customer,
					"customer_name": unpaid_invoice.get("customer_name", ""),
					"outstanding_amount": flt(unpaid_invoice.outstanding_amount)
				}
			)
		)
		closing_shift.credit_sales_total += flt(unpaid_invoice.outstanding_amount)
	
	# Calculate overdue sales total
	for overdue_invoice in overdue_invoices:
		closing_shift.overdue_sales_total += flt(overdue_invoice.outstanding_amount)

	for d in invoices:
		pos_transactions.append(
			frappe._dict(
				{
					"sales_invoice": d.name,
					"posting_date": d.posting_date,
					"grand_total": d.grand_total,
					"customer": d.customer,
				}
			)
		)
		closing_shift.grand_total += flt(d.grand_total)
		closing_shift.net_total += flt(d.net_total)
		closing_shift.total_quantity += flt(d.total_qty)

		for t in d.taxes:
			existing_tax = [tx for tx in taxes if tx.account_head == t.account_head and tx.rate == t.rate]
			if existing_tax:
				existing_tax[0].amount += flt(t.tax_amount)
			else:
				taxes.append(
					frappe._dict(
						{
							"account_head": t.account_head,
							"rate": t.rate,
							"amount": t.tax_amount,
						}
					)
				)

		for p in d.payments:
			existing_pay = [pay for pay in payments if pay.mode_of_payment == p.mode_of_payment]
			if existing_pay:
				cash_mode_of_payment = frappe.get_value(
					"POS Profile",
					opening_shift.get("pos_profile"),
					"posa_cash_mode_of_payment",
				)
				if not cash_mode_of_payment:
					cash_mode_of_payment = "Cash"
				if existing_pay[0].mode_of_payment == cash_mode_of_payment:
					amount = p.amount - d.change_amount
				else:
					amount = p.amount
				existing_pay[0].expected_amount += flt(amount)
			else:
				payments.append(
					frappe._dict(
						{
							"mode_of_payment": p.mode_of_payment,
							"opening_amount": 0,
							"expected_amount": p.amount,
						}
					)
				)

	pos_payments = get_payments_entries(opening_shift.get("name"))

	for py in pos_payments:
		pos_payments_table.append(
			frappe._dict(
				{
					"payment_entry": py.name,
					"mode_of_payment": py.mode_of_payment,
					"paid_amount": py.paid_amount,
					"posting_date": py.posting_date,
					"customer": py.party,
				}
			)
		)
		existing_pay = [pay for pay in payments if pay.mode_of_payment == py.mode_of_payment]
		if existing_pay:
			existing_pay[0].expected_amount += flt(py.paid_amount)
		else:
			payments.append(
				frappe._dict(
					{
						"mode_of_payment": py.mode_of_payment,
						"opening_amount": 0,
						"expected_amount": py.paid_amount,
					}
				)
			)

	closing_shift.set("pos_transactions", pos_transactions)
	closing_shift.set("payment_reconciliation", payments)
	closing_shift.set("taxes", taxes)
	closing_shift.set("pos_payments", pos_payments_table)
	closing_shift.set("credit_sales_details", credit_sales_list)

	return closing_shift


@frappe.whitelist()
def submit_closing_shift(closing_shift):
	closing_shift = json.loads(closing_shift)
	
	opening_shift = closing_shift.get("pos_opening_shift")
	user = closing_shift.get("user")
	if opening_shift and user:
		existing_shift = frappe.db.get_value(
			"POS Closing Shift",
			{
				"pos_opening_shift": opening_shift,
				"user": user,
				"docstatus": 1,
			},
			"name",
		)
		if existing_shift:
			return existing_shift
	
	closing_shift_doc = frappe.get_doc(closing_shift)
	closing_shift_doc.flags.ignore_permissions = True
	try:
		closing_shift_doc.save()
		closing_shift_doc.submit()
	except frappe.ValidationError:
		if opening_shift and user:
			existing_shift = frappe.db.get_value(
				"POS Closing Shift",
				{
					"pos_opening_shift": opening_shift,
					"user": user,
					"docstatus": 1,
				},
				"name",
			)
			if existing_shift:
				return existing_shift
		raise
	
	# Return the closing shift name for frontend to handle printing
	return closing_shift_doc.name


def submit_printed_invoices(pos_opening_shift):
	invoices_list = frappe.get_all(
		"Sales Invoice",
		filters={
			"posa_pos_opening_shift": pos_opening_shift,
			"docstatus": 0,
			"posa_is_printed": 1,
		},
	)
	for invoice in invoices_list:
		invoice_doc = frappe.get_doc("Sales Invoice", invoice.name)
		invoice_doc.submit()


@frappe.whitelist()
def get_last_closed_shift(pos_profile=None, user=None):
	"""Return the most recent submitted POS Closing Shift name.

	- Defaults to the current session user.
	- If pos_profile is provided, restrict results to that profile.
	"""
	user = user or frappe.session.user
	filters = {"docstatus": 1, "user": user}
	if pos_profile:
		filters["pos_profile"] = pos_profile

	rows = frappe.get_all(
		"POS Closing Shift",
		filters=filters,
		pluck="name",
		order_by="modified desc",
		limit_page_length=1,
	)
	return rows[0] if rows else None


@frappe.whitelist()
def print_cashier_shift_report(closing_shift_name):
	"""
	Print the cashier shift report automatically when closing shift
	Uses the same calculation logic as make_closing_shift_from_opening
	"""
	closing_shift_doc = frappe.get_doc("POS Closing Shift", closing_shift_name)
	
	# Get company and user details
	company = frappe.get_doc("Company", closing_shift_doc.company)
	user = frappe.get_doc("User", closing_shift_doc.user)
	pos_profile = frappe.get_doc("POS Profile", closing_shift_doc.pos_profile)
	
	# Get items sold during the shift
	items_sold = get_items_sold_during_shift(closing_shift_doc.pos_opening_shift)
	
	# Get unpaid invoices (credit sales) for this shift - same as make_closing_shift_from_opening
	unpaid_invoices = get_unpaid_invoices(closing_shift_doc.pos_opening_shift)
	
	# Get overdue invoices for this shift - same as make_closing_shift_from_opening
	overdue_invoices = get_overdue_invoices(closing_shift_doc.pos_opening_shift)
	
	# Get petty cash entries for this shift
	petty_cash_data = get_petty_cash_entries_for_shift(closing_shift_doc.pos_opening_shift)
	
	# Get sales returns for this shift - same as make_closing_shift_from_opening
	sales_returns_data = get_sales_returns_for_shift(closing_shift_doc.pos_opening_shift)
	
	# Calculate using the EXACT same logic as make_closing_shift_from_opening
	# Use values from closing_shift_doc fields that were set by make_closing_shift_from_opening
	returns_total = flt(closing_shift_doc.return_sales_total or 0)
	returns_count = flt(closing_shift_doc.return_sales_count or 0)
	
	# Use credit_sales_total and overdue_sales_total from closing_shift_doc (set by make_closing_shift_from_opening)
	credit_sales_total = flt(closing_shift_doc.credit_sales_total or 0)
	overdue_sales_total = flt(closing_shift_doc.overdue_sales_total or 0)
	unpaid_invoices_count = len(unpaid_invoices)
	overdue_invoices_count = len(overdue_invoices)
	
	# Use grand_total and net_total from closing_shift_doc (set by make_closing_shift_from_opening)
	grand_total = flt(closing_shift_doc.grand_total or 0)
	net_total = flt(closing_shift_doc.net_total or 0)
	
	# Calculate cash values from payment reconciliation
	opening_cash_balance = 0
	cash_sales_net = 0
	cash_payment_found = False
	cash_closing_amount = 0
	
	# Get Cash mode of payment from POS Profile
	cash_mode_of_payment = frappe.get_value("POS Profile", closing_shift_doc.pos_profile, "posa_cash_mode_of_payment")
	if not cash_mode_of_payment:
		cash_mode_of_payment = "Cash"
	
	for payment in closing_shift_doc.payment_reconciliation:
		if payment.mode_of_payment == cash_mode_of_payment or 'cash' in payment.mode_of_payment.lower():
			opening_cash_balance = flt(payment.opening_amount or 0)
			cash_sales_net = flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0)
			cash_payment_found = True
			cash_closing_amount = flt(payment.closing_amount or 0)
			break
	
	# Cash sales total (gross) = NET cash + returns
	cash_sales_total = cash_sales_net + returns_total
	
	# Calculate total payments (sum of all payment modes excluding opening amounts)
	total_payments = sum(flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0) 
	                     for payment in closing_shift_doc.payment_reconciliation)
	
	# Net Sales = grand_total (which already includes returns properly from make_closing_shift_from_opening)
	net_sales = grand_total
	
	# Total amount = payments + credit + overdue
	total_amount = total_payments + credit_sales_total + overdue_sales_total
	
	# Pay In/Pay Out from petty cash
	pay_in_amount = flt(petty_cash_data.get('pay_in_total', 0) or 0)
	pay_out_amount = flt(petty_cash_data.get('pay_out_total', 0) or 0)
	
	# Expected cash in drawer = opening + net cash sales + pay in - pay out
	expected_cash_in_drawer = opening_cash_balance + cash_sales_net + pay_in_amount - pay_out_amount
	cash_over_short = cash_closing_amount - expected_cash_in_drawer if cash_payment_found else 0
	
	# Prepare data for template
	report_data = {
		"closing_shift": closing_shift_doc,
		"company": company,
		"user": user,
		"pos_profile": pos_profile,
		"items_sold": items_sold,
		"unpaid_invoices": unpaid_invoices,
		"overdue_invoices": overdue_invoices,
		"petty_cash_data": petty_cash_data,
		"sales_returns_data": sales_returns_data,
		"currency": company.default_currency,
		"report_date": frappe.utils.nowdate(),
		"report_time": frappe.utils.nowtime(),
		# Pre-calculated values from make_closing_shift_from_opening
		"opening_balance": opening_cash_balance,
		"cash_sales_total": cash_sales_total,
		"credit_sales_total": credit_sales_total,
		"unpaid_invoices_count": unpaid_invoices_count,
		"overdue_sales_total": overdue_sales_total,
		"overdue_invoices_count": overdue_invoices_count,
		"total_payments": total_payments,
		"grand_total": grand_total,
		"gross_sales": net_sales,  # Same as net_sales from make_closing_shift_from_opening
		"net_sales": net_sales,
		"net_total": net_total,
		"total_amount": total_amount,
		"expected_cash_in_drawer": expected_cash_in_drawer,
		"cash_over_short": cash_over_short,
		"cash_payment_found": cash_payment_found,
		"cash_closing_amount": cash_closing_amount,
		"pay_in_amount": pay_in_amount,
		"pay_out_amount": pay_out_amount,
		# Sales returns from closing_shift_doc (set by make_closing_shift_from_opening)
		"returns_total": returns_total,
		"returns_count": returns_count,
		"returns_list": sales_returns_data.get('returns', [])
	}
	
	# Generate HTML content
	html_content = frappe.render_template(
		"posawesome/posawesome/doctype/pos_closing_shift/cashier_shift_report.html",
		report_data
	)
	
	# Create a temporary print format
	print_format_name = f"temp_cashier_report_{closing_shift_name}"
	
	# Check if print format already exists
	if not frappe.db.exists("Print Format", print_format_name):
		print_format = frappe.new_doc("Print Format")
		print_format.name = print_format_name
		print_format.doc_type = "POS Closing Shift"
		print_format.format = "HTML"
		print_format.html = html_content
		print_format.standard = "No"
		print_format.save(ignore_permissions=True)
	else:
		# Update existing print format
		print_format = frappe.get_doc("Print Format", print_format_name)
		print_format.html = html_content
		print_format.save(ignore_permissions=True)
	
	# Generate print URL
	base_url = frappe.utils.get_url()
	print_url = f"{base_url}/printview?doctype=POS%20Closing%20Shift&name={closing_shift_name}&format={print_format_name}&trigger_print=1"
	
	# Log the print URL for debugging
	
	# Return the print URL for frontend to handle
	return print_url


@frappe.whitelist()
def direct_print_cashier_shift_report(closing_shift_name):
	"""
	Direct print function that generates HTML and returns it for immediate printing
	Uses the same calculation logic as make_closing_shift_from_opening
	"""
	closing_shift_doc = frappe.get_doc("POS Closing Shift", closing_shift_name)
	
	# Get company and user details
	company = frappe.get_doc("Company", closing_shift_doc.company)
	user = frappe.get_doc("User", closing_shift_doc.user)
	pos_profile = frappe.get_doc("POS Profile", closing_shift_doc.pos_profile)
	
	# Get items sold during the shift
	items_sold = get_items_sold_during_shift(closing_shift_doc.pos_opening_shift)
	
	# Get unpaid invoices (credit sales) for this shift - same as make_closing_shift_from_opening
	unpaid_invoices = get_unpaid_invoices(closing_shift_doc.pos_opening_shift)
	
	# Get overdue invoices for this shift - same as make_closing_shift_from_opening
	overdue_invoices = get_overdue_invoices(closing_shift_doc.pos_opening_shift)
	
	# Get petty cash entries for this shift
	petty_cash_data = get_petty_cash_entries_for_shift(closing_shift_doc.pos_opening_shift)
	
	# Get sales returns for this shift - same as make_closing_shift_from_opening
	sales_returns_data = get_sales_returns_for_shift(closing_shift_doc.pos_opening_shift)
	
	# Calculate using the EXACT same logic as make_closing_shift_from_opening
	# Use values from closing_shift_doc fields that were set by make_closing_shift_from_opening
	returns_total = flt(closing_shift_doc.return_sales_total or 0)
	returns_count = flt(closing_shift_doc.return_sales_count or 0)
	
	# Use credit_sales_total and overdue_sales_total from closing_shift_doc (set by make_closing_shift_from_opening)
	credit_sales_total = flt(closing_shift_doc.credit_sales_total or 0)
	overdue_sales_total = flt(closing_shift_doc.overdue_sales_total or 0)
	unpaid_invoices_count = len(unpaid_invoices)
	overdue_invoices_count = len(overdue_invoices)
	
	# Use grand_total and net_total from closing_shift_doc (set by make_closing_shift_from_opening)
	grand_total = flt(closing_shift_doc.grand_total or 0)
	net_total = flt(closing_shift_doc.net_total or 0)
	
	# Calculate cash values from payment reconciliation
	opening_cash_balance = 0
	cash_sales_net = 0
	cash_payment_found = False
	cash_closing_amount = 0
	
	# Get Cash mode of payment from POS Profile
	cash_mode_of_payment = frappe.get_value("POS Profile", closing_shift_doc.pos_profile, "posa_cash_mode_of_payment")
	if not cash_mode_of_payment:
		cash_mode_of_payment = "Cash"
	
	for payment in closing_shift_doc.payment_reconciliation:
		if payment.mode_of_payment == cash_mode_of_payment or 'cash' in payment.mode_of_payment.lower():
			opening_cash_balance = flt(payment.opening_amount or 0)
			cash_sales_net = flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0)
			cash_payment_found = True
			cash_closing_amount = flt(payment.closing_amount or 0)
			break
	
	# Cash sales total (gross) = NET cash + returns
	cash_sales_total = cash_sales_net + returns_total
	
	# Calculate total payments (sum of all payment modes excluding opening amounts)
	total_payments = sum(flt(payment.expected_amount or 0) - flt(payment.opening_amount or 0) 
	                     for payment in closing_shift_doc.payment_reconciliation)
	
	# Net Sales = grand_total (which already includes returns properly from make_closing_shift_from_opening)
	net_sales = grand_total
	
	# Gross Sales = Net Sales (in this context they are the same from make_closing_shift_from_opening)
	gross_sales = grand_total
	
	# Total amount = payments + credit + overdue
	total_amount = total_payments + credit_sales_total + overdue_sales_total
	
	# Pay In/Pay Out from petty cash
	pay_in_amount = flt(petty_cash_data.get('pay_in_total', 0) or 0)
	pay_out_amount = flt(petty_cash_data.get('pay_out_total', 0) or 0)
	
	# Expected cash in drawer = opening + net cash sales + pay in - pay out
	expected_cash_in_drawer = opening_cash_balance + cash_sales_net + pay_in_amount - pay_out_amount
	
	# Calculate cash over/short
	cash_over_short = cash_closing_amount - expected_cash_in_drawer if cash_payment_found else 0
	
	# Prepare data for template
	report_data = {
		"closing_shift": closing_shift_doc,
		"company": company,
		"user": user,
		"pos_profile": pos_profile,
		"items_sold": items_sold,
		"unpaid_invoices": unpaid_invoices,
		"overdue_invoices": overdue_invoices,
		"petty_cash_data": petty_cash_data,
		"sales_returns_data": sales_returns_data,
		"currency": company.default_currency,
		"report_date": frappe.utils.nowdate(),
		"report_time": frappe.utils.nowtime(),
		# Pre-calculated values from make_closing_shift_from_opening
		"opening_balance": opening_cash_balance,
		"cash_sales_total": cash_sales_total,
		"credit_sales_total": credit_sales_total,
		"unpaid_invoices_count": unpaid_invoices_count,
		"overdue_sales_total": overdue_sales_total,
		"overdue_invoices_count": overdue_invoices_count,
		"total_payments": total_payments,
		"grand_total": grand_total,
		"gross_sales": gross_sales,
		"net_sales": net_sales,
		"net_total": net_total,
		"total_amount": total_amount,
		"expected_cash_in_drawer": expected_cash_in_drawer,
		"cash_over_short": cash_over_short,
		"cash_payment_found": cash_payment_found,
		"cash_closing_amount": cash_closing_amount,
		"pay_in_amount": pay_in_amount,
		"pay_out_amount": pay_out_amount,
		# Sales returns from closing_shift_doc (set by make_closing_shift_from_opening)
		"returns_total": returns_total,
		"returns_count": returns_count,
		"returns_list": sales_returns_data.get('returns', [])
	}
	
	# Generate HTML content
	html_content = frappe.render_template(
		"posawesome/posawesome/doctype/pos_closing_shift/cashier_shift_report.html",
		report_data
	)
	
	# Return the HTML content for direct printing
	return html_content


@frappe.whitelist()
def create_and_submit_petty_cash_entry(entry_data):
	"""
	Create and submit a petty cash entry
	"""
	try:
		# Parse the JSON string if it's passed as a string
		if isinstance(entry_data, str):
			import json
			entry_data = json.loads(entry_data)
		
		# Validate required fields
		if not entry_data.get("amount") or entry_data.get("amount") <= 0:
			return {
				"success": False,
				"message": "Amount must be greater than 0"
			}
		
		if not entry_data.get("note") or not entry_data.get("note").strip():
			return {
				"success": False,
				"message": "Note is required"
			}
		
		if not entry_data.get("entry_type"):
			return {
				"success": False,
				"message": "Entry type is required"
			}
		
		# Create the petty cash document
		petty_cash_doc = frappe.new_doc("Petty Cash")
		petty_cash_doc.date = entry_data.get("date")
		petty_cash_doc.entry_type = entry_data.get("entry_type")
		petty_cash_doc.pos_shift = entry_data.get("pos_shift")
		petty_cash_doc.pos_profile = entry_data.get("pos_profile")
		petty_cash_doc.amount = entry_data.get("amount")
		petty_cash_doc.note = entry_data.get("note")
		petty_cash_doc.opening_amount = entry_data.get("opening_amount", 0)
		petty_cash_doc.closing_amount = entry_data.get("closing_amount", 0)
		
		# Insert and submit
		petty_cash_doc.insert(ignore_permissions=True)
		petty_cash_doc.submit()
		
		return {
			"success": True,
			"message": f"Petty Cash {entry_data.get('entry_type')} recorded successfully",
			"doc_name": petty_cash_doc.name
		}
		
	except Exception as e:
		return {
			"success": False,
			"message": f"Failed to record petty cash entry: {str(e)}"
		}


@frappe.whitelist()
def get_petty_cash_entries_for_shift(pos_opening_shift):
	"""
	Get petty cash entries for a specific POS shift
	"""
	try:
		# Get petty cash entries for the shift period
		petty_cash_entries = frappe.get_all(
			"POS Petty Cash Entry",
			filters={
				"pos_shift": pos_opening_shift,
				"docstatus": 1  # Submitted entries only
			},
			fields=["entry_type", "amount", "note", "date"]
		)
		
		# Calculate totals
		pay_in_total = sum(entry.amount for entry in petty_cash_entries if entry.entry_type == "Pay In")
		pay_out_total = sum(entry.amount for entry in petty_cash_entries if entry.entry_type == "Pay Out")
		
		return {
			"entries": petty_cash_entries,
			"pay_in_total": pay_in_total,
			"pay_out_total": pay_out_total,
			"total_entries": len(petty_cash_entries)
		}
	except Exception as e:
		return {
			"entries": [],
			"pay_in_total": 0,
			"pay_out_total": 0,
			"total_entries": 0
		}


def get_sales_returns_for_shift(pos_opening_shift):
	"""
	Get sales returns for a specific POS shift period
	"""
	try:
		return_sales = frappe.get_all(
			"Sales Invoice",
			filters={
				"posa_pos_opening_shift": pos_opening_shift,
				"docstatus": 1,
				"is_return": 1,
			},
			fields=["name", "customer", "grand_total", "posting_date", "posting_time", "posa_pos_opening_shift"]
		)
		print(f"DEBUG: Return sales: {return_sales}")
		return {
			"returns": return_sales,
			"returns_total": sum(abs(flt(return_inv.grand_total)) for return_inv in return_sales),
			"returns_count": len(return_sales)
		}
		
	except Exception as e:
		return {
			"returns": [],
			"returns_total": 0,
			"returns_count": 0
		}

def get_items_sold_during_shift(pos_opening_shift):
	"""
	Get items sold during the shift with quantities and amounts
	"""
	invoices = frappe.get_all(
		"Sales Invoice",
		filters={
			"posa_pos_opening_shift": pos_opening_shift,
			"docstatus": 1,
		},
		fields=["name"]
	)
	
	items_summary = {}
	
	for invoice in invoices:
		invoice_doc = frappe.get_doc("Sales Invoice", invoice.name)
		for item in invoice_doc.items:
			item_key = item.item_code
			if item_key not in items_summary:
				items_summary[item_key] = {
					"item_name": item.item_name,
					"qty": 0,
					"amount": 0
				}
			items_summary[item_key]["qty"] += item.qty
			items_summary[item_key]["amount"] += item.amount
	
	items_list = []
	for item_code, data in items_summary.items():
		items_list.append({
			"item_code": item_code,
			"item_name": data["item_name"],
			"qty": data["qty"],
			"amount": data["amount"]
		})
	
	items_list.sort(key=lambda x: x["amount"], reverse=True)
	
	return items_list


@frappe.whitelist()
def test_return_sales_data():
	"""
	Test function to check return sales data in the system
	"""
	# Check for any return invoices in the system
	all_returns = frappe.get_all(
		"Sales Invoice",
		filters={
			"is_return": 1,
			"is_pos": 1,
			"docstatus": ["in", [0, 1, 2]]
		},
		fields=["name", "customer", "grand_total", "posting_date", "posa_pos_opening_shift", "docstatus"]
	)
	
	# Check for returns in the last 7 days
	recent_returns = frappe.get_all(
		"Sales Invoice",
		filters={
			"is_return": 1,
			"is_pos": 1,
			"posting_date": [">=", frappe.utils.add_days(frappe.utils.today(), -7)],
			"docstatus": ["in", [0, 1, 2]]
		},
		fields=["name", "customer", "grand_total", "posting_date", "posa_pos_opening_shift", "docstatus"]
	)
	
	return {
		"all_returns_count": len(all_returns),
		"recent_returns_count": len(recent_returns),
		"all_returns": all_returns[:10],  # First 10 for debugging
		"recent_returns": recent_returns
	}


@frappe.whitelist()
def test_return_sales_query(shift_name):
	"""
	Test the return sales query for a specific shift
	"""
	try:
		# Test the shift-linked query
		shift_linked_returns = frappe.get_all(
			"Sales Invoice",
			filters={
				"is_return": 1,
				"is_pos": 1,
				"posa_pos_opening_shift": shift_name,
				"docstatus": ["in", [0, 1, 2]],
			},
			fields=["name", "customer", "grand_total", "posting_date", "posting_time", "posa_pos_opening_shift"]
		)
		
		# Test a broader query to see all returns
		all_returns = frappe.get_all(
			"Sales Invoice",
			filters={
				"is_return": 1,
				"is_pos": 1,
				"docstatus": ["in", [0, 1, 2]],
			},
			fields=["name", "customer", "grand_total", "posting_date", "posting_time", "posa_pos_opening_shift"]
		)
		
		return {
			"shift_name": shift_name,
			"shift_linked_count": len(shift_linked_returns),
			"shift_linked_returns": shift_linked_returns,
			"all_returns_count": len(all_returns),
			"all_returns": all_returns[:10]  # First 10 for debugging
		}
		
	except Exception as e:
		return {
			"error": str(e)
		}


@frappe.whitelist()
def create_test_return_sales():
	"""
	Create a test return sales entry for testing purposes
	"""
	try:
		# Get the latest POS opening shift
		latest_shift = frappe.get_all(
			"POS Opening Shift",
			filters={"docstatus": 1},
			fields=["name"],
			order_by="creation desc",
			limit=1
		)
		
		if not latest_shift:
			return {"error": "No POS opening shift found"}
		
		shift_name = latest_shift[0].name
		
		# Create a test return invoice
		return_invoice = frappe.new_doc("Sales Invoice")
		return_invoice.is_return = 1
		return_invoice.is_pos = 1
		return_invoice.posa_pos_opening_shift = shift_name
		return_invoice.customer = "Test Customer"
		return_invoice.posting_date = frappe.utils.today()
		return_invoice.posting_time = frappe.utils.nowtime()
		return_invoice.company = frappe.defaults.get_global_default("company")
		
		# Add a test item
		return_invoice.append("items", {
			"item_code": "Test Item",
			"item_name": "Test Return Item",
			"qty": -1,  # Negative quantity for return
			"rate": 10.00,
			"amount": -10.00
		})
		
		return_invoice.grand_total = -10.00
		return_invoice.total = -10.00
		return_invoice.insert()
		return_invoice.submit()
		
		return {
			"success": True,
			"message": f"Test return invoice created: {return_invoice.name}",
			"invoice_name": return_invoice.name,
			"shift_name": shift_name
		}
		
	except Exception as e:
		return {
			"success": False,
			"error": str(e)
		}


