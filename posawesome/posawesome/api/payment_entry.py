# Copyright (c) 2021, Youssef Restom and contributors
# For license information, please see license.txt

import frappe, erpnext, json
from frappe import _
from frappe.utils import nowdate, getdate, flt
from erpnext.accounts.party import get_party_account
from erpnext.accounts.utils import get_account_currency
from erpnext.accounts.doctype.journal_entry.journal_entry import (
	get_default_bank_cash_account,
)
from erpnext.setup.utils import get_exchange_rate
from erpnext.accounts.doctype.bank_account.bank_account import get_party_bank_account
from posawesome.posawesome.api.m_pesa import submit_mpesa_payment
from erpnext.accounts.utils import (
	QueryPaymentLedger,
	get_outstanding_invoices as _get_outstanding_invoices,
	reconcile_against_document,
)
from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry


def create_payment_entry(
	company,
	customer,
	amount,
	currency,
	mode_of_payment,
	reference_date=None,
	reference_no=None,
	posting_date=None,
	cost_center=None,
	remarks=None,
	custom_remarks=0,
	discount_amount=0,
	writeoff_account=None,
	writeoff_cost_center=None,
	submit=0,
):
	date = nowdate() if not posting_date else posting_date
	party_type = "Customer"

	# Cache commonly used values
	company_doc = frappe.get_cached_doc("Company", company)
	company_currency = company_doc.default_currency
	letter_head = company_doc.default_letter_head

	# Get party account and currency in one call
	party_account = get_party_account(party_type, customer, company)
	party_account_currency = get_account_currency(party_account)

	if party_account_currency != currency:
		frappe.throw(
			_(
				"Currency is not correct, party account currency is {party_account_currency} and transaction currency is {currency}"
			).format(party_account_currency=party_account_currency, currency=currency)
		)
	payment_type = "Receive"

	# Get bank details in one call
	bank = get_bank_cash_account(company, mode_of_payment)

	# Get exchange rate
	conversion_rate = get_exchange_rate(currency, company_currency, date, "for_selling")

	# Calculate amounts
	paid_amount, received_amount = set_paid_amount_and_received_amount(
		party_account_currency, bank, amount, payment_type, None, conversion_rate
	)

	# Create payment entry with minimal db calls
	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = payment_type
	pe.company = company
	pe.cost_center = cost_center or erpnext.get_default_cost_center(company)
	pe.posting_date = date
	pe.mode_of_payment = mode_of_payment
	pe.party_type = party_type
	pe.party = customer
	pe.paid_from = party_account if payment_type == "Receive" else bank.account
	pe.paid_to = party_account if payment_type == "Pay" else bank.account
	pe.paid_from_account_currency = (
		party_account_currency if payment_type == "Receive" else bank.account_currency
	)
	pe.paid_to_account_currency = party_account_currency if payment_type == "Pay" else bank.account_currency
	pe.paid_amount = paid_amount
	pe.received_amount = received_amount
	pe.letter_head = letter_head
	pe.reference_date = reference_date
	pe.reference_no = reference_no

	if custom_remarks and remarks:
		pe.remarks = remarks

	if pe.meta.has_field("custom_remarks"):
		pe.custom_remarks = 1 if (custom_remarks and remarks) else 0

	# Set bank account if available
	if pe.party_type in ["Customer", "Supplier"]:
		bank_account = get_party_bank_account(pe.party_type, pe.party)
		if bank_account:
			pe.bank_account = bank_account
			pe.set_bank_account_data()

	# Set required fields
	pe.setup_party_account_field()
	pe.set_missing_values()
	pe.set_exchange_rate()

	if not pe.source_exchange_rate:
		pe.source_exchange_rate = conversion_rate or 1
	if not pe.target_exchange_rate:
		if pe.paid_from_account_currency == pe.paid_to_account_currency:
			pe.target_exchange_rate = pe.source_exchange_rate
		else:
			pe.target_exchange_rate = conversion_rate or 1

	if flt(discount_amount) > 0 and writeoff_account:
		pe.append(
			"deductions",
			{
				"account": writeoff_account,
				"cost_center": writeoff_cost_center or pe.cost_center,
				"amount": flt(discount_amount),
			},
		)
		pe.write_off_amount = flt(discount_amount)

	if party_account and bank:
		pe.set_amounts()

	# Insert and submit in one go if needed
	pe.insert(ignore_permissions=True)
	if submit:
		pe.submit()

	return pe


def get_bank_cash_account(company, mode_of_payment, bank_account=None):
	bank = get_default_bank_cash_account(
		company, "Bank", mode_of_payment=mode_of_payment, account=bank_account
	)

	if not bank:
		bank = get_default_bank_cash_account(
			company, "Cash", mode_of_payment=mode_of_payment, account=bank_account
		)

	return bank


def set_paid_amount_and_received_amount(
	party_account_currency,
	bank,
	outstanding_amount,
	payment_type,
	bank_amount,
	conversion_rate,
):
	paid_amount = received_amount = 0
	if party_account_currency == bank.account_currency:
		paid_amount = received_amount = abs(outstanding_amount)
	elif payment_type == "Receive":
		paid_amount = abs(outstanding_amount)
		if bank_amount:
			received_amount = bank_amount
		else:
			received_amount = paid_amount * conversion_rate

	else:
		received_amount = abs(outstanding_amount)
		if bank_amount:
			paid_amount = bank_amount
		else:
			# if party account currency and bank currency is different then populate paid amount as well
			paid_amount = received_amount * conversion_rate

	return paid_amount, received_amount


@frappe.whitelist()
def get_outstanding_invoices(customer=None, company=None, currency=None, pos_profile=None):
	try:
		party_account = get_party_account("Customer", customer, company)

		frappe.logger().debug(
			f"Fetching outstanding invoices for customer: {customer}, party_account: {party_account}"
		)

		# Build filters
		filters = {
			"company": company,
			"customer": customer,
			"outstanding_amount": (">", 0),
			"docstatus": 1,
			"is_return": 0,
		}

		if currency:
			filters["currency"] = currency

		if pos_profile:
			filters["pos_profile"] = pos_profile

		# Get all outstanding invoices directly from Sales Invoice
		outstanding_invoices = frappe.get_all(
			"Sales Invoice",
			filters=filters,
			fields=[
				"name as voucher_no",
				"outstanding_amount",
				"grand_total as invoice_amount",
				"due_date",
				"posting_date",
				"currency",
				"pos_profile",
				"customer",
				"customer_name",
			],
			order_by="posting_date desc",
		)

		# Ensure all amounts are properly formatted
		for invoice in outstanding_invoices:
			invoice.outstanding_amount = flt(invoice.outstanding_amount)
			invoice.invoice_amount = flt(invoice.invoice_amount)

		frappe.logger().debug(f"Found {len(outstanding_invoices)} outstanding invoices")
		frappe.logger().debug(
			f"First invoice data: {outstanding_invoices[0] if outstanding_invoices else 'No invoices'}"
		)

		return outstanding_invoices
	except Exception as e:
		frappe.logger().error(f"Error in get_outstanding_invoices: {str(e)}")
		return []


@frappe.whitelist()
def get_unallocated_payments(customer, company, currency, mode_of_payment=None):
	filters = {
		"party": customer,
		"company": company,
		"docstatus": 1,
		"party_type": "Customer",
		"payment_type": "Receive",
		"unallocated_amount": [">", 0],
		"paid_from_account_currency": currency,
	}
	if mode_of_payment:
		filters.update({"mode_of_payment": mode_of_payment})
	unallocated_payment = frappe.get_all(
		"Payment Entry",
		filters=filters,
		fields=[
			"name",
			"paid_amount",
			"party_name as customer_name",
			"received_amount",
			"posting_date",
			"unallocated_amount",
			"mode_of_payment",
			"paid_from_account_currency as currency",
		],
		order_by="posting_date asc",
	)
	return unallocated_payment


@frappe.whitelist()
def get_mode_of_payment_types(mode_of_payments=None):
	if not mode_of_payments:
		return {}

	if isinstance(mode_of_payments, str):
		try:
			mode_of_payments = json.loads(mode_of_payments)
		except Exception:
			mode_of_payments = [mode_of_payments]

	if not isinstance(mode_of_payments, list):
		return {}

	mode_of_payments = [m for m in mode_of_payments if m]
	if not mode_of_payments:
		return {}

	rows = frappe.get_all(
		"Mode of Payment",
		filters={"name": ["in", mode_of_payments]},
		fields=["name", "type"],
		limit_page_length=len(mode_of_payments),
	)

	return {row.name: row.type for row in rows}


@frappe.whitelist()
def process_pos_payment(payload):
	data = json.loads(payload)
	data = frappe._dict(data)
	if not data.pos_profile.get("posa_use_pos_awesome_payments"):
		frappe.throw(_("POS Awesome Payments is not enabled for this POS Profile"))

	# Log short summary only to avoid truncation
	frappe.log_error(
		f"Payment request from {data.customer} for {data.total_payment_methods} amount with {len(data.selected_invoices)} invoices",
		"POS Payment Debug",
	)

	# validate data
	if not data.customer:
		frappe.throw(_("Customer is required"))
	if not data.company:
		frappe.throw(_("Company is required"))
	if not data.currency:
		frappe.throw(_("Currency is required"))
	if not data.pos_profile_name:
		frappe.throw(_("POS Profile is required"))
	if not data.pos_opening_shift_name:
		frappe.throw(_("POS Opening Shift is required"))

	company = data.company
	currency = data.currency
	customer = data.customer
	remarks = (data.get("remarks") or "").strip()
	custom_remarks = 1 if data.get("custom_remarks") and remarks else 0
	pos_opening_shift_name = data.pos_opening_shift_name
	discount_amount = flt(data.get("discount_amount"))
	allow_make_new_payments = data.pos_profile.get("posa_allow_make_new_payments")
	allow_reconcile_payments = data.pos_profile.get("posa_allow_reconcile_payments")
	allow_mpesa_reconcile_payments = data.pos_profile.get("posa_allow_mpesa_reconcile_payments")
	today = nowdate()
	payment_entry_has_custom_remarks_field = frappe.get_meta("Payment Entry").has_field(
		"custom_remarks"
	)
	writeoff_account = frappe.get_cached_value("Company", company, "write_off_account") or data.pos_profile.get(
		"write_off_account"
	)
	pos_profile_cost_center = data.pos_profile.get("write_off_cost_center") or data.pos_profile.get(
		"cost_center"
	)
	if not pos_profile_cost_center and data.pos_profile_name:
		pos_profile_cost_center = frappe.get_cached_value(
			"POS Profile", data.pos_profile_name, "write_off_cost_center"
		) or frappe.get_cached_value("POS Profile", data.pos_profile_name, "cost_center")
	writeoff_cost_center = (
		pos_profile_cost_center
		or frappe.get_cached_value("Company", company, "cost_center")
		or erpnext.get_default_cost_center(company)
	)
	if discount_amount > 0 and not writeoff_account:
		frappe.throw(_("Please set a Write Off Account in Company"))

	new_payments_entry = []
	all_payments_entry = []
	created_journal_entries = []
	errors = []
	all_payment_names = set()
	new_payment_names = set()
	payment_sources = []
	discount_applied = False

	def add_all_payment(payment_entry):
		if not payment_entry:
			return
		if payment_entry.name not in all_payment_names:
			all_payment_names.add(payment_entry.name)
			all_payments_entry.append(payment_entry)

	def add_new_payment(payment_entry):
		if not payment_entry:
			return
		if payment_entry.name not in new_payment_names:
			new_payment_names.add(payment_entry.name)
			new_payments_entry.append(payment_entry)
		add_all_payment(payment_entry)

	def add_payment_source(payment_entry, amount=None):
		if not payment_entry:
			return

		payment_name = (
			payment_entry.get("name")
			if isinstance(payment_entry, dict)
			else getattr(payment_entry, "name", None)
		)
		if not payment_name:
			return

		paid_from_account = (
			payment_entry.get("paid_from")
			if isinstance(payment_entry, dict)
			else getattr(payment_entry, "paid_from", None)
		)
		mode_of_payment = (
			payment_entry.get("mode_of_payment")
			if isinstance(payment_entry, dict)
			else getattr(payment_entry, "mode_of_payment", None)
		)

		default_unallocated_amount = (
			payment_entry.get("unallocated_amount")
			if isinstance(payment_entry, dict)
			else getattr(payment_entry, "unallocated_amount", 0)
		)
		remaining_amount = (
			flt(amount) if amount is not None else flt(default_unallocated_amount)
		)
		if remaining_amount <= 0:
			return

		payment_sources.append(
			frappe._dict(
				{
					"payment_entry": payment_name,
					"mode_of_payment": mode_of_payment,
					"account": paid_from_account,
					"remaining_amount": remaining_amount,
					"unreconciled_amount": remaining_amount,
					"allocated_invoices": [],
				}
			)
		)

	def apply_custom_remarks(payment_entry_name):
		if not (custom_remarks and remarks and payment_entry_name):
			return

		values = {"remarks": remarks}
		if payment_entry_has_custom_remarks_field:
			values["custom_remarks"] = 1

		frappe.db.set_value("Payment Entry", payment_entry_name, values, update_modified=False)

	def get_payment_method_type(payment_method):
		payment_type = (payment_method.get("type") or "").strip()
		if payment_type:
			return payment_type

		mode_of_payment = payment_method.get("mode_of_payment")
		if not mode_of_payment:
			return ""
		return (frappe.db.get_value("Mode of Payment", mode_of_payment, "type") or "").strip()

	def is_bank_payment_method(payment_method):
		return get_payment_method_type(payment_method).lower() == "bank"

	selected_invoices = data.selected_invoices or []
	if len(selected_invoices) == 0:
		frappe.throw(_("Please select an invoice"))

	invoices_to_allocate = []
	for invoice in selected_invoices:
		invoice_name = invoice.get("voucher_no") or invoice.get("name")
		if not invoice_name:
			continue

		outstanding_amount = flt(invoice.get("outstanding_amount"))
		if outstanding_amount <= 0:
			outstanding_amount = flt(
				frappe.db.get_value("Sales Invoice", invoice_name, "outstanding_amount")
			)

		if outstanding_amount <= 0:
			continue

		invoices_to_allocate.append(
			frappe._dict(
				{
					"voucher_no": invoice_name,
					"remaining_outstanding": outstanding_amount,
				}
			)
		)

	if len(invoices_to_allocate) == 0:
		frappe.throw(_("No outstanding amount found for selected invoices"))

	# process mpesa payments first so they can be reconciled with the same allocation flow
	if (
		allow_mpesa_reconcile_payments
		and len(data.selected_mpesa_payments) > 0
		and flt(data.total_selected_mpesa_payments) > 0
	):
		for mpesa_payment in data.selected_mpesa_payments:
			try:
				new_mpesa_payment = submit_mpesa_payment(mpesa_payment.get("name"), customer)
				apply_custom_remarks(new_mpesa_payment.name)
				new_mpesa_payment.reload()
				add_new_payment(new_mpesa_payment)
				add_payment_source(
					new_mpesa_payment,
					amount=flt(new_mpesa_payment.unallocated_amount or new_mpesa_payment.paid_amount),
				)
			except Exception as e:
				errors.append(str(e))

	# selected existing unallocated payments
	if (
		allow_reconcile_payments
		and len(data.selected_payments) > 0
		and flt(data.total_selected_payments) > 0
	):
		for payment in data.selected_payments:
			payment_name = payment.get("name")
			if not payment_name:
				continue

			try:
				payment_entry_doc = frappe.get_doc("Payment Entry", payment_name)
				add_all_payment(payment_entry_doc)
				add_payment_source(payment_entry_doc, amount=flt(payment_entry_doc.unallocated_amount))
			except Exception as e:
				errors.append(str(e))

	# process new payments and submit each one so it can be reconciled like other payment entries
	if allow_make_new_payments and len(data.payment_methods) > 0 and flt(data.total_payment_methods) > 0:
		valid_payment_methods = [
			payment_method
			for payment_method in data.payment_methods
			if flt(payment_method.get("amount")) > 0 and payment_method.get("mode_of_payment")
		]
		last_payment_method_index = len(valid_payment_methods) - 1

		for payment_method_index, payment_method in enumerate(valid_payment_methods):
			amount = flt(payment_method.get("amount"))
			mode_of_payment = payment_method.get("mode_of_payment")
			reference_no = (payment_method.get("reference_no") or "").strip()
			reference_date = payment_method.get("reference_date")

			if is_bank_payment_method(payment_method):
				if not reference_no:
					frappe.throw(
						_("Reference No is required for Bank payment method {0}").format(mode_of_payment)
					)
				if not reference_date:
					frappe.throw(
						_("Reference Date is required for Bank payment method {0}").format(mode_of_payment)
					)
			else:
				reference_no = pos_opening_shift_name
				reference_date = today

			try:
				apply_discount = (
					discount_amount > 0
					and not discount_applied
					and payment_method_index == last_payment_method_index
				)
				new_payment_entry = create_payment_entry(
					company=company,
					customer=customer,
					currency=currency,
					amount=amount,
					mode_of_payment=mode_of_payment,
					posting_date=today,
					reference_no=reference_no,
					reference_date=reference_date,
					cost_center=writeoff_cost_center,
					remarks=remarks,
					custom_remarks=custom_remarks,
					discount_amount=discount_amount if apply_discount else 0,
					writeoff_account=writeoff_account,
					writeoff_cost_center=writeoff_cost_center,
					submit=1,
				)

				add_new_payment(new_payment_entry)
				if apply_discount:
					discount_applied = True

				add_payment_source(
					new_payment_entry,
					amount=flt(new_payment_entry.unallocated_amount or amount),
				)
			except Exception as e:
				error_message = frappe.get_traceback(with_context=False)
				frappe.log_error(error_message, "POS Awesome Payment Entry Creation")
				errors.append(str(e) or error_message)

	if discount_amount > 0 and not discount_applied:
		if errors:
			frappe.throw(errors[0])
		frappe.throw(_("Discount requires at least one new payment method"))

	total_available_payments = sum(flt(source.remaining_amount) for source in payment_sources)
	if total_available_payments <= 0:
		frappe.throw(_("Please make a payment or select an payment"))

	dr_or_cr = "credit_in_account_currency"
	entry_list = []

	for source in payment_sources:
		payment_remaining = flt(source.remaining_amount)
		if payment_remaining <= 0:
			continue

		for invoice in invoices_to_allocate:
			invoice_remaining = flt(invoice.remaining_outstanding)
			if invoice_remaining <= 0:
				continue

			allocation = min(payment_remaining, invoice_remaining)
			if allocation <= 0:
				continue

			entry_list.append(
				frappe._dict(
					{
						"voucher_type": "Payment Entry",
						"voucher_no": source.payment_entry,
						"voucher_detail_no": None,
						"against_voucher_type": "Sales Invoice",
						"against_voucher": invoice.voucher_no,
						"account": source.account,
						"party_type": "Customer",
						"party": customer,
						"dr_or_cr": dr_or_cr,
						"unreconciled_amount": flt(source.unreconciled_amount),
						"unadjusted_amount": flt(source.unreconciled_amount),
						"allocated_amount": flt(allocation),
						"difference_amount": 0,
					}
				)
			)

			source.allocated_invoices.append({"name": invoice.voucher_no, "amount": allocation})

			payment_remaining -= allocation
			invoice.remaining_outstanding = invoice_remaining - allocation

			if payment_remaining <= 0:
				break

		source.remaining_amount = payment_remaining

	if len(entry_list) == 0:
		frappe.throw(_("No allocation could be created for selected invoices and payments"))

	try:
		reconcile_against_document(entry_list)
	except Exception as e:
		frappe.db.rollback()
		frappe.log_error(f"Error allocating payment: {str(e)}", "POS Payment Error")
		errors.append(str(e))
		frappe.throw(_("Unable to allocate payments. Please check payment amounts and try again."))

	for source in payment_sources:
		allocated_amount = sum(flt(invoice.get("amount")) for invoice in source.allocated_invoices)
		if allocated_amount <= 0:
			continue

		created_journal_entries.append(
			{
				"name": source.payment_entry,
				"mode_of_payment": source.mode_of_payment,
				"amount": allocated_amount,
				"allocated_invoices": source.allocated_invoices,
				"type": "Payment Entry",
			}
		)

	# then show the results
	msg = ""
	if len(new_payments_entry) > 0:
		msg += "<h4>New Payments</h4>"
		msg += "<table class='table table-bordered'>"
		msg += "<thead><tr><th>Payment Entry</th><th>Mode of Payment</th><th>Amount</th></tr></thead>"
		msg += "<tbody>"
		for payment_entry in new_payments_entry:
			msg += "<tr><td>{0}</td><td>{1}</td><td>{2}</td></tr>".format(
				payment_entry.get("name"),
				payment_entry.get("mode_of_payment") or "-",
				payment_entry.get("paid_amount") or payment_entry.get("amount"),
			)
		msg += "</tbody>"
		msg += "</table>"
	if len(created_journal_entries) > 0:
		msg += "<h4>Payment Allocations</h4>"
		msg += "<table class='table table-bordered'>"
		msg += "<thead><tr><th>Document</th><th>Mode of Payment</th><th>Amount</th><th>Type</th></tr></thead>"
		msg += "<tbody>"
		for entry in created_journal_entries:
			msg += "<tr><td>{0}</td><td>{1}</td><td>{2}</td><td>{3}</td></tr>".format(
				entry.get("name"),
				entry.get("mode_of_payment") or "-",
				entry.get("amount"),
				entry.get("type", "Journal Entry"),
			)
		msg += "</tbody>"
		msg += "</table>"

		# Show all allocated invoices in one consolidated table.
		allocated_rows = []
		for entry in created_journal_entries:
			for invoice in entry.get("allocated_invoices") or []:
				allocated_rows.append(
					{
						"payment_entry": entry.get("name"),
						"mode_of_payment": entry.get("mode_of_payment") or "-",
						"invoice": invoice.get("name"),
						"amount": invoice.get("amount"),
					}
				)

		if allocated_rows:
			msg += "<h4>Allocated Invoices</h4>"
			msg += "<table class='table table-bordered'>"
			msg += "<thead><tr><th>Payment Entry</th><th>Mode of Payment</th><th>Invoice</th><th>Amount</th></tr></thead>"
			msg += "<tbody>"
			for row in allocated_rows:
				msg += "<tr><td>{0}</td><td>{1}</td><td>{2}</td><td>{3}</td></tr>".format(
					row.get("payment_entry"),
					row.get("mode_of_payment"),
					row.get("invoice"),
					row.get("amount"),
				)
			msg += "</tbody>"
			msg += "</table>"
	if len(errors) > 0:
		msg += "<h4>Errors</h4>"
		msg += "<table class='table table-bordered'>"
		msg += "<thead><tr><th>Error</th></tr></thead>"
		msg += "<tbody>"
		for error in errors:
			msg += "<tr><td>{0}</td></tr>".format(error)
		msg += "</tbody>"
		msg += "</table>"
	if len(msg) > 0:
		frappe.msgprint(msg)

	return {
		"new_payments_entry": new_payments_entry,
		"all_payments_entry": all_payments_entry,
		"created_journal_entries": created_journal_entries,
		"errors": errors,
	}


@frappe.whitelist()
def get_available_pos_profiles(company, currency):
	pos_profiles_list = frappe.get_list(
		"POS Profile",
		filters={"disabled": 0, "company": company, "currency": currency},
		page_length=1000,
		pluck="name",
	)
	return pos_profiles_list


def get_party_account(party_type, party, company):
	try:
		# First try to get from Party Account
		account = frappe.get_cached_value(
			"Party Account",
			{"parenttype": party_type, "parent": party, "company": company},
			"account",
		)

		if not account:
			# Try to get default account from company
			account = frappe.get_cached_value(
				"Company",
				company,
				("default_receivable_account" if party_type == "Customer" else "default_payable_account"),
			)

		if not account:
			frappe.log_error(
				f"No account found for {party_type} {party} in company {company}",
				"POS Account Error",
			)

		return account
	except Exception as e:
		frappe.log_error(f"Error getting party account: {str(e)}")
		return None


def create_direct_journal_entry(
	company,
	customer,
	invoices_list,
	payment_amount,
	bank_account=None,
	mode_of_payment=None,
):
	"""Create a journal entry directly to handle payment allocation and bypass payment entry reconciliation issues"""
	try:
		frappe.log_error(
			f"Creating direct journal entry for {customer} with amount {payment_amount}",
			"Direct JE Debug",
		)

		# Get today's date
		today = nowdate()

		# Get receivable account
		receivable_account = get_party_account("Customer", customer, company)
		frappe.log_error(f"Using receivable account: {receivable_account}", "Direct JE Debug")

		if not receivable_account:
			frappe.log_error("Receivable account not found, trying default", "Direct JE Debug")
			receivable_account = frappe.get_cached_value("Company", company, "default_receivable_account")

		if not receivable_account:
			frappe.throw(
				f"Account not found for customer {customer} in company {company}. Please set up default receivable account."
			)

		# If bank_account is not provided, try to get it from mode_of_payment
		if not bank_account:
			frappe.log_error(
				f"Bank account not provided, trying mode_of_payment: {mode_of_payment}",
				"Direct JE Debug",
			)
			if mode_of_payment:
				# Get mode of payment account for this company
				payment_account = frappe.get_value(
					"Mode of Payment Account",
					{"parent": mode_of_payment, "company": company},
					"default_account",
				)

				if payment_account:
					bank_account = payment_account
					frappe.log_error(
						f"Found payment account from mode_of_payment: {bank_account}",
						"Direct JE Debug",
					)
				else:
					# Use bank/cash account
					bank = get_bank_cash_account(company, mode_of_payment)
					if bank and bank.get("account"):
						bank_account = bank.get("account")
						frappe.log_error(
							f"Found bank account from get_bank_cash_account: {bank_account}",
							"Direct JE Debug",
						)

			# If still no bank account, use cash account as fallback
			if not bank_account:
				frappe.log_error("No bank account found, using Cash account", "Direct JE Debug")
				cash_account = frappe.get_value(
					"Mode of Payment Account",
					{"parent": "Cash", "company": company},
					"default_account",
				)

				if cash_account:
					bank_account = cash_account
				else:
					# Final fallback - try to get company's default cash account
					bank_account = frappe.get_value("Company", company, "default_cash_account")

				frappe.log_error(f"Using fallback cash account: {bank_account}", "Direct JE Debug")

		if not bank_account:
			frappe.throw(
				"Could not determine bank/cash account for payment. Please set default cash account for company."
			)

		frappe.log_error(f"Final bank/cash account: {bank_account}", "Direct JE Debug")

		# Create Journal Entry
		je = frappe.new_doc("Journal Entry")
		je.voucher_type = "Journal Entry"
		je.company = company
		je.posting_date = today
		je.user_remark = f"Payment allocation for customer {customer}"

		# Add bank/cash debit entry
		je.append(
			"accounts",
			{
				"account": bank_account,
				"debit_in_account_currency": payment_amount,
				"credit_in_account_currency": 0,
			},
		)

		# Add receivable credit entries for each invoice
		remaining_amount = payment_amount
		allocated_invoices = []

		for invoice in invoices_list:
			invoice_name = invoice.get("voucher_no") or invoice.get("name")
			outstanding_amount = flt(invoice.get("outstanding_amount"))

			# Skip invalid invoices
			if not invoice_name or outstanding_amount <= 0:
				frappe.log_error(
					f"Skipping invoice {invoice_name or 'Unknown'} with outstanding {outstanding_amount}",
					"Direct JE Debug",
				)
				continue

			# Calculate allocation for this invoice (limited by remaining amount)
			allocation = min(remaining_amount, outstanding_amount)
			if allocation <= 0:
				frappe.log_error(f"Zero allocation for invoice {invoice_name}", "Direct JE Debug")
				continue

			# Subtract from remaining amount
			remaining_amount -= allocation

			# Add receivable credit for this invoice
			je.append(
				"accounts",
				{
					"account": receivable_account,
					"party_type": "Customer",
					"party": customer,
					"credit_in_account_currency": allocation,
					"debit_in_account_currency": 0,
					"reference_type": "Sales Invoice",
					"reference_name": invoice_name,
				},
			)

			# Track what invoices were allocated
			allocated_invoices.append({"name": invoice_name, "amount": allocation})

			frappe.log_error(
				f"Allocated {allocation} to invoice {invoice_name}",
				"Direct JE Allocation",
			)

			if remaining_amount <= 0:
				break

		# If we have valid entries, save and submit JE
		if len(je.accounts) > 1:  # Need at least 2 entries (bank + receivable)
			frappe.log_error(f"Saving JE with {len(je.accounts)} entries", "Direct JE Debug")

			# Before saving, validate the accounting data
			total_debit = sum(flt(d.debit_in_account_currency) for d in je.accounts)
			total_credit = sum(flt(d.credit_in_account_currency) for d in je.accounts)

			frappe.log_error(
				f"JE validation: Total Debit={total_debit}, Total Credit={total_credit}",
				"Direct JE Debug",
			)

			# Ensure balanced entry
			if abs(total_debit - total_credit) > 0.01:
				frappe.log_error(
					f"Unbalanced JE: debit={total_debit}, credit={total_credit}",
					"Direct JE Error",
				)
				# Add an adjustment entry if needed
				if total_debit > total_credit:
					je.append(
						"accounts",
						{
							"account": receivable_account,
							"party_type": "Customer",
							"party": customer,
							"credit_in_account_currency": total_debit - total_credit,
							"debit_in_account_currency": 0,
						},
					)
				else:
					je.append(
						"accounts",
						{
							"account": bank_account,
							"debit_in_account_currency": total_credit - total_debit,
							"credit_in_account_currency": 0,
						},
					)

				frappe.log_error(f"Added adjustment entry to balance JE", "Direct JE Debug")

			try:
				je.insert(ignore_permissions=True)
				je.submit()
				frappe.db.commit()

				frappe.log_error(
					f"Successfully created and submitted JE {je.name}",
					"Direct JE Success",
				)

				return {
					"name": je.name,
					"amount": payment_amount - remaining_amount,
					"allocated_invoices": allocated_invoices,
				}
			except Exception as save_error:
				frappe.log_error(f"Error saving/submitting JE: {str(save_error)}", "Direct JE Error")
				frappe.db.rollback()
				return None
		else:
			frappe.log_error("No valid entries for Journal Entry", "Direct JE Error")
			return None
	except Exception as e:
		frappe.log_error(f"Error creating direct Journal Entry: {str(e)}", "Direct JE Error")
		frappe.db.rollback()
		return None


# Add this new function to handle payment entry cancellation
def on_payment_entry_cancel(doc, method):
	try:
		# Check if this payment entry has a linked journal entry
		linked_je = doc.get("posa_linked_je")
		if not linked_je:
			return

		# Get the Journal Entry document
		je_doc = frappe.get_doc("Journal Entry", linked_je)

		# Only cancel if JE is submitted
		if je_doc.docstatus == 1:
			frappe.log_error(
				f"Cancelling linked Journal Entry {linked_je} because Payment Entry {doc.name} was cancelled",
				"POS Auto Cancel",
			)

			# Cancel the Journal Entry
			je_doc.cancel()
			frappe.db.commit()

			frappe.msgprint(
				f"Linked Journal Entry {linked_je} has been cancelled automatically",
				alert=True,
			)
	except Exception as e:
		frappe.log_error(f"Error cancelling linked Journal Entry: {str(e)}", "POS Error")
		frappe.msgprint(f"Error cancelling linked Journal Entry: {str(e)}", indicator="red")


# Add this code at the end of the file
def setup_payment_entry_cancel_hook():
	"""Setup event hooks for Payment Entry cancellation"""
	try:
		# Check if custom field exists using the correct method
		custom_field_exists = frappe.db.exists(
			"Custom Field", {"dt": "Payment Entry", "fieldname": "posa_linked_je"}
		)

		if not custom_field_exists:
			try:
				# Create custom field to store linked Journal Entry
				field = frappe.get_doc(
					{
						"doctype": "Custom Field",
						"dt": "Payment Entry",
						"fieldname": "posa_linked_je",
						"label": "POS Awesome Linked JE",
						"fieldtype": "Link",
						"options": "Journal Entry",
						"read_only": 1,
						"hidden": 0,
						"description": "Linked Journal Entry created by POS Awesome",
						"insert_after": "remarks",
						"translatable": 0,
					}
				)
				field.insert(ignore_permissions=True)
				frappe.db.commit()
				frappe.log_error("Successfully created custom field for Payment Entry", "POS Setup")
			except frappe.DuplicateEntryError:
				# Field already exists, which is fine
				frappe.log_error("Custom field already exists for Payment Entry", "POS Setup")
				pass
			except Exception as e:
				frappe.log_error(f"Error creating custom field: {str(e)}", "POS Setup Error")
				return False
		else:
			frappe.log_error(
				f"Custom field 'posa_linked_je' already exists for Payment Entry",
				"POS Setup",
			)

		# Log the completion
		frappe.log_error("Payment Entry cancel hook setup complete", "POS Setup")
		return True
	except Exception as e:
		# Ensure error message is not truncated in the logs
		error_msg = str(e)
		# Log in chunks if the error message is too long
		if len(error_msg) > 1000:
			for i in range(0, len(error_msg), 1000):
				chunk = error_msg[i : i + 1000]
				frappe.log_error(
					f"Error in setup_payment_entry_cancel_hook (part {i // 1000 + 1}): {chunk}",
					"POS Error",
				)
		else:
			frappe.log_error(f"Error in setup_payment_entry_cancel_hook: {error_msg}", "POS Error")
		return False


# Don't auto-run setup on import - this can cause issues
# setup_payment_entry_cancel_hook()


@frappe.whitelist()
def manual_setup_payment_entry_cancel_hook():
	"""Function to manually trigger the setup of payment entry cancel hook"""
	result = setup_payment_entry_cancel_hook()
	if result:
		frappe.msgprint("Payment Entry cancel hook setup successfully", alert=True)
		return {"success": True, "message": "Setup successful"}
	else:
		frappe.msgprint("Failed to setup Payment Entry cancel hook. Check error logs.", alert=True)
		return {"success": False, "message": "Setup failed, check logs"}


@frappe.whitelist()
def fix_payment_entry_links():
	"""Fix missing links between payment entries and journal entries"""
	try:
		# Get all payment entries
		payment_entries = frappe.get_all(
			"Payment Entry",
			filters={"docstatus": 1, "payment_type": "Receive"},
			fields=["name", "creation", "reference_no"],
		)

		# Counter for updated entries
		updated = 0

		for pe in payment_entries:
			# Skip entries that already have a linked JE
			if frappe.db.get_value("Payment Entry", pe.name, "posa_linked_je"):
				continue

			# Try to find journal entries created around the same time
			# Look for JEs within 5 minutes of the payment entry creation
			je_list = frappe.get_all(
				"Journal Entry",
				filters={
					"docstatus": 1,
					"creation": [
						"between",
						[
							frappe.utils.add_to_date(pe.creation, minutes=-5),
							frappe.utils.add_to_date(pe.creation, minutes=5),
						],
					],
				},
				fields=["name"],
			)

			# If we found possible journal entries, check if any has a reference to this payment
			if je_list:
				for je in je_list:
					# Check if this JE has any comment linking to this PE
					comments = frappe.get_all(
						"Comment",
						filters={
							"reference_doctype": "Journal Entry",
							"reference_name": je.name,
							"content": ["like", f"%{pe.name}%"],
						},
						fields=["name"],
					)

					if comments:
						# Found a match! Update the payment entry
						frappe.db.set_value("Payment Entry", pe.name, "posa_linked_je", je.name)

						# Add a comment to the payment entry as well
						frappe.get_doc(
							{
								"doctype": "Comment",
								"comment_type": "Info",
								"reference_doctype": "Payment Entry",
								"reference_name": pe.name,
								"content": f"Linked with Journal Entry: {je.name} (auto-fixed)",
							}
						).insert(ignore_permissions=True)

						updated += 1
						break

		frappe.db.commit()
		return {
			"success": True,
			"message": f"Fixed {updated} payment entries with missing journal entry links",
		}

	except Exception as e:
		frappe.log_error(f"Error fixing payment entry links: {str(e)}", "POS Fix Error")
		return {"success": False, "message": f"Error: {str(e)}"}
