<!-- eslint-disable vue/multi-word-component-names -->
<template>
	<div class="pa-0">
		<v-card
			:class="['selection mx-auto pa-1 my-0 mt-3', isDarkTheme ? '' : 'bg-grey-lighten-5']"
			:style="isDarkTheme ? 'background-color:#1E1E1E' : ''"
			style="max-height: 68vh; height: 68vh"
		>
			<v-progress-linear
				:active="loading"
				:indeterminate="loading"
				absolute
				location="top"
				color="info"
			></v-progress-linear>
			<div class="overflow-y-auto pa-2" style="max-height: 67vh">
				<v-row v-if="invoice_doc" class="pa-1" dense>
					<v-col cols="7">
						<v-text-field
							variant="solo"
							color="primary"
							:label="frappe._('Paid Amount')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							v-model="total_payments_display"
							readonly
							:prefix="currencySymbol(invoice_doc.currency)"
							density="compact"
							@click="showPaidAmount"
						></v-text-field>
					</v-col>
					<v-col cols="5">
						<v-text-field
							variant="solo"
							color="primary"
							label="To Be Paid"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							v-model="diff_payment_display"
							:prefix="currencySymbol(invoice_doc.currency)"
							density="compact"
							@focus="showDiffPayment"
							persistent-placeholder
						></v-text-field>
					</v-col>

					<!-- Paid Change (if applicable) -->
					<v-col cols="7" v-if="credit_change > 0 && !invoice_doc.is_return">
						<v-text-field
							variant="solo"
							color="primary"
							:label="frappe._('Paid Change')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							:model-value="formatCurrency(paid_change)"
							:prefix="currencySymbol(invoice_doc.currency)"
							:rules="paid_change_rules"
							density="compact"
							readonly
							type="text"
							@click="showPaidChange"
						></v-text-field>
					</v-col>

					<!-- Credit Change (if applicable) -->
					<v-col cols="5" v-if="credit_change > 0 && !invoice_doc.is_return">
						<v-text-field
							variant="solo"
							color="primary"
							:label="frappe._('Credit Change')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							:model-value="formatCurrency(credit_change)"
							:prefix="currencySymbol(invoice_doc.currency)"
							density="compact"
							type="text"
							@change="
								setFormatedCurrency(this, 'credit_change', null, false, $event);
								updateCreditChange(this.credit_change);
							"
						></v-text-field>
					</v-col>
				</v-row>

				<v-divider></v-divider>

				<div v-if="is_cashback">
					<v-row
						class="payments pa-1"
						v-for="payment in invoice_doc.payments"
						:key="payment.name || `${payment.mode_of_payment}-${payment.idx || ''}`"
					>
						<v-col cols="6" v-if="!is_mpesa_c2b_payment(payment)">
							<v-text-field
								density="compact"
								variant="solo"
								color="primary"
								:label="frappe._(payment.mode_of_payment)"
								:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
								class="dark-field sleek-field"
								hide-details
								:model-value="formatCurrency(payment.amount)"
								@change="setFormatedCurrency(payment, 'amount', null, false, $event)"
								:rules="[
									isNumber,
									(v) =>
										!payment.mode_of_payment.toLowerCase().includes('cash') ||
										this.is_credit_sale ||
										v >=
											(this.invoice_doc.rounded_total ||
												this.invoice_doc.grand_total) ||
										'Cash payment cannot be less than invoice total when credit sale is off',
								]"
								:prefix="currencySymbol(invoice_doc.currency)"
								:input-props="{ 'data-mode-of-payment': payment.mode_of_payment }"
								@focus="set_rest_amount(payment.idx)"
								:readonly="invoice_doc.is_return"
							></v-text-field>
						</v-col>
						<v-col cols="6" v-if="!is_mpesa_c2b_payment(payment)">
							<v-btn block color="primary" theme="dark" @click="set_full_amount(payment)">
								{{ payment.mode_of_payment }}
							</v-btn>
						</v-col>

						<!-- M-Pesa Payment Button (if payment is M-Pesa) -->
						<v-col cols="12" v-if="is_mpesa_c2b_payment(payment)" class="pl-3">
							<v-btn block color="success" theme="dark" @click="mpesa_c2b_dialog(payment)">
								{{ __("Get Payments") }} {{ payment.mode_of_payment }}
							</v-btn>
						</v-col>

						<!-- Request Payment for Phone Type -->
						<v-col
							cols="3"
							v-if="payment.type === 'Phone' && payment.amount > 0 && request_payment_field"
							class="pl-1"
						>
							<v-btn
								block
								color="success"
								theme="dark"
								:disabled="payment.amount === 0"
								@click="request_payment(payment)"
							>
								{{ __("Request") }}
							</v-btn>
						</v-col>
					</v-row>
				</div>

				<v-row
					class="payments pa-1"
					v-if="invoice_doc && available_points_amount > 0 && !invoice_doc.is_return"
				>
					<v-col cols="7">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Redeem Loyalty Points')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="formatCurrency(loyalty_amount)"
							type="text"
							@change="setFormatedCurrency(this, 'loyalty_amount', null, false, $event)"
							:prefix="currencySymbol(invoice_doc.currency)"
						></v-text-field>
					</v-col>
					<v-col cols="5">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('You can redeem up to')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="formatFloat(available_points_amount)"
							:prefix="currencySymbol(invoice_doc.currency)"
							readonly
						></v-text-field>
					</v-col>
				</v-row>



				<v-divider></v-divider>

				<v-row class="pa-1">
					<v-col cols="6">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Net Total')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							:model-value="formatCurrency(invoice_doc.net_total, displayCurrency)"
							readonly
							:prefix="currencySymbol()"
							persistent-placeholder
						></v-text-field>
					</v-col>
					<v-col cols="6">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Tax and Charges')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="
								formatCurrency(invoice_doc.total_taxes_and_charges, displayCurrency)
							"
							readonly
							:prefix="currencySymbol()"
							persistent-placeholder
						></v-text-field>
					</v-col>
					<v-col cols="6">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Total Amount')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="formatCurrency(invoice_doc.total, displayCurrency)"
							readonly
							:prefix="currencySymbol()"
							persistent-placeholder
						></v-text-field>
					</v-col>
					<v-col cols="6">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="diff_label"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="formatCurrency(diff_payment, displayCurrency)"
							readonly
							:prefix="currencySymbol()"
							persistent-placeholder
						></v-text-field>
					</v-col>
					<v-col cols="6">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Discount Amount')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="formatCurrency(invoice_doc.discount_amount)"
							readonly
							:prefix="currencySymbol(invoice_doc.currency)"
							persistent-placeholder
						></v-text-field>
					</v-col>
					<v-col cols="6">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Grand Total')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="formatCurrency(invoice_doc.grand_total)"
							readonly
							:prefix="currencySymbol(invoice_doc.currency)"
							persistent-placeholder
						></v-text-field>
					</v-col>
					<v-col v-if="invoice_doc.rounded_total" cols="6">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Rounded Total')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							:model-value="formatCurrency(invoice_doc.rounded_total)"
							readonly
							:prefix="currencySymbol(invoice_doc.currency)"
							persistent-placeholder
						></v-text-field>
					</v-col>

					<v-col cols="6" v-if="pos_profile.posa_allow_sales_order && invoiceType === 'Order'">
						<VueDatePicker
							v-model="new_delivery_date"
							model-type="format"
							format="dd-MM-yyyy"
							:min-date="new Date()"
							auto-apply
							:dark="isDarkTheme"
							class="dark-field sleek-field"
							@update:model-value="update_delivery_date()"
						/>
					</v-col>
					<v-col cols="12" v-if="invoice_doc.posa_delivery_date">
						<v-autocomplete
							density="compact"
							clearable
							auto-select-first
							variant="solo"
							color="primary"
							:label="frappe._('Address')"
							v-model="invoice_doc.shipping_address_name"
							:items="addresses"
							item-title="address_title"
							item-value="name"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							no-data-text="Address not found"
							hide-details
							:customFilter="addressFilter"
							append-icon="mdi-plus"
							@click:append="new_address"
						>
							<template v-slot:item="{ item }">
								<v-list-item>
									<v-list-item-title class="text-primary text-subtitle-1">
										<div v-html="item.address_title"></div>
									</v-list-item-title>
									<v-list-item-subtitle>
										<div v-html="item.address_line1"></div>
									</v-list-item-subtitle>
									<v-list-item-subtitle v-if="item.address_line2">
										<div v-html="item.address_line2"></div>
									</v-list-item-subtitle>
									<v-list-item-subtitle v-if="item.city">
										<div v-html="item.city"></div>
									</v-list-item-subtitle>
									<v-list-item-subtitle v-if="item.state">
										<div v-html="item.state"></div>
									</v-list-item-subtitle>
									<v-list-item-subtitle v-if="item.country">
										<div v-html="item.country"></div>
									</v-list-item-subtitle>
									<v-list-item-subtitle v-if="item.mobile_no">
										<div v-html="item.mobile_no"></div>
									</v-list-item-subtitle>
									<v-list-item-subtitle v-if="item.address_type">
										<div v-html="item.address_type"></div>
									</v-list-item-subtitle>
								</v-list-item>
							</template>
						</v-autocomplete>
					</v-col>
				</v-row>

				<!-- Customer Purchase Order (if enabled in POS profile) -->
				<div v-if="pos_profile.posa_allow_customer_purchase_order">
					<v-divider></v-divider>
					<v-row class="pa-1" justify="center" align="start">
						<v-col cols="6">
							<v-text-field
								v-model="invoice_doc.po_no"
								:label="frappe._('Purchase Order')"
								variant="solo"
								density="compact"
								:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
								class="dark-field sleek-field"
								clearable
								color="primary"
								hide-details
							></v-text-field>
						</v-col>
						<v-col cols="6">
							<VueDatePicker
								v-model="new_po_date"
								model-type="format"
								format="dd-MM-yyyy"
								:min-date="new Date()"
								auto-apply
								:dark="isDarkTheme"
								class="dark-field sleek-field"
								@update:model-value="update_po_date()"
							/>
							<v-text-field
								v-model="invoice_doc.po_date"
								:label="frappe._('Purchase Order Date')"
								readonly
								variant="solo"
								density="compact"
								hide-details
								color="primary"
							></v-text-field>
						</v-col>
					</v-row>
				</div>

				<v-divider></v-divider>

				<!-- Switches for Write Off and Credit Sale -->
				<v-row class="pa-1" align="start" no-gutters>
					<v-col
						cols="6"
						v-if="
							pos_profile.posa_allow_write_off_change &&
							credit_change > 0 &&
							!invoice_doc.is_return
						"
					>
						<v-switch
							v-model="is_write_off_change"
							flat
							:label="frappe._('Write Off Difference Amount')"
							class="my-0 pa-1"
						></v-switch>
					</v-col>
					<v-col cols="6" v-if="!invoice_doc.is_return">
						<v-switch 
							v-model="is_credit_sale" 
							:label="frappe._('Credit Sale?')"
							color="primary"
							class="my-0 pa-1"
							@update:model-value="handleCreditSaleToggle"
						>
							<template v-slot:label>
								<div class="d-flex align-center">
									<v-icon class="mr-2" color="primary">mdi-credit-card-outline</v-icon>
									<span class="text-body-2 font-weight-medium">{{ frappe._('Credit Sale?') }}</span>
								</div>
							</template>
						</v-switch>
						<div v-if="is_credit_sale" class="mt-2 pa-2 bg-blue-lighten-5 rounded-lg">
							<v-icon class="mr-2" color="info" size="small">mdi-information-outline</v-icon>
							<span class="text-caption text-blue-darken-2">
								{{ frappe._("Credit sale enabled. No payment required - customer will pay later.") }}
							</span>
						</div>

					</v-col>
					<v-col cols="6" v-if="invoice_doc.is_return && pos_profile.use_cashback">
						<v-switch
							v-model="is_cashback"
							flat
							:label="frappe._('Cashback?')"
							class="my-0 pa-1"
						></v-switch>
					</v-col>
					<v-col cols="6" v-if="invoice_doc.is_return">
						<v-switch
							v-model="is_credit_return"
							flat
							:label="frappe._('Credit Return?')"
							class="my-0 pa-1"
						></v-switch>
					</v-col>
					<v-col cols="6" v-if="is_credit_sale">
						<VueDatePicker
							v-model="new_credit_due_date"
							model-type="format"
							format="dd-MM-yyyy"
							:min-date="new Date()"
							auto-apply
							:dark="isDarkTheme"
							class="dark-field sleek-field"
							@update:model-value="update_credit_due_date()"
						/>
						<v-text-field
							class="mt-2 dark-field sleek-field"
							density="compact"
							variant="solo"
							type="number"
							min="0"
							max="365"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							v-model.number="credit_due_days"
							:label="frappe._('Days until due')"
							hide-details
							@change="applyDuePreset(credit_due_days)"
						></v-text-field>
						<div class="mt-1">
							<v-chip
								v-for="d in credit_due_presets"
								:key="d"
								size="small"
								class="ma-1"
								variant="solo"
								color="primary"
								@click="applyDuePreset(d)"
							>
								{{ d }} {{ frappe._("days") }}
							</v-chip>
						</div>
					</v-col>

				</v-row>



				<v-divider></v-divider>

				<!-- Sales Person Selection -->
				<v-row class="pb-0 mb-2" align="start">
					<v-col cols="12">
						<p v-if="sales_persons && sales_persons.length > 0" class="mt-1 mb-1 text-subtitle-2">
							{{ sales_persons.length }} sales persons found
						</p>
						<p v-else class="mt-1 mb-1 text-subtitle-2 text-red">No sales persons found</p>
						<v-select
							density="compact"
							clearable
							variant="solo"
							color="primary"
							:label="frappe._('Sales Person')"
							v-model="sales_person"
							:items="sales_persons"
							item-title="title"
							item-value="value"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							:no-data-text="__('Sales Person not found')"
							hide-details
							:disabled="readonly"
						></v-select>
					</v-col>
				</v-row>
			</div>
		</v-card>

		<!-- Action Buttons -->
		<v-card flat class="cards mb-0 mt-3 pa-0">
			<v-row align="start" no-gutters>
				<v-col cols="6">
					<v-btn
						block
						size="large"
						color="primary"
						theme="dark"
						@click="submit"
						:loading="loading"
						:disabled="loading || vaildatPayment"
					>
						{{ __("Submit") }}
					</v-btn>
				</v-col>
				<v-col cols="6" class="pl-1">
					<v-btn
						block
						size="large"
						color="success"
						theme="dark"
						@click="submit(undefined, false, true)"
						:loading="loading"
						:disabled="loading || vaildatPayment"
					>
						{{ __("Submit & Print") }}
					</v-btn>
				</v-col>
				<v-col cols="12">
					<v-btn
						block
						class="mt-2 pa-1"
						size="large"
						color="error"
						theme="dark"
						@click="back_to_invoice"
					>
						{{ __("Cancel Payment") }}
					</v-btn>
				</v-col>
			</v-row>
		</v-card>
		<!-- Custom Days Dialog -->
		<v-dialog v-model="custom_days_dialog" max-width="300px">
			<v-card>
				<v-card-title class="text-h6">
					{{ __("Custom Due Days") }}
				</v-card-title>
				<v-card-text class="pa-0">
					<v-container>
						<v-text-field
							density="compact"
							variant="solo"
							type="number"
							min="0"
							max="365"
							class="dark-field sleek-field"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							v-model.number="custom_days_value"
							:label="frappe._('Days')"
							hide-details
						></v-text-field>
					</v-container>
				</v-card-text>
				<v-card-actions>
					<v-spacer></v-spacer>
					<v-btn color="error" theme="dark" @click="custom_days_dialog = false">
						{{ __("Close") }}
					</v-btn>
					<v-btn color="primary" theme="dark" @click="applyCustomDays">
						{{ __("Apply") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Phone Payment Dialog -->
		<v-dialog v-model="phone_dialog" max-width="400px">
			<v-card>
				<v-card-title>
					<span class="text-h5 text-primary">{{ __("Confirm Mobile Number") }}</span>
				</v-card-title>
				<v-card-text class="pa-0">
					<v-container>
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('Mobile Number')"
							:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
							class="dark-field sleek-field"
							hide-details
							v-model="invoice_doc.contact_mobile"
							type="number"
						></v-text-field>
					</v-container>
				</v-card-text>
				<v-card-actions>
					<v-spacer></v-spacer>
					<v-btn color="error" theme="dark" @click="phone_dialog = false">
						{{ __("Close") }}
					</v-btn>
					<v-btn color="primary" theme="dark" @click="request_payment">
						{{ __("Request") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script>
/* eslint-disable vue/no-dupe-keys */
// Importing format mixin for currency and utility functions
import format from "../../format";
import {
	saveOfflineInvoice,
	syncOfflineInvoices,
	getPendingOfflineInvoiceCount,
	isOffline,
	getSalesPersonsStorage,
	setSalesPersonsStorage,
	updateLocalStock,
} from "../../../offline/index.js";

import generateOfflineInvoiceHTML from "../../../offline_print_template";
import { silentPrint } from "../../plugins/print.js";

export default {
	// Using format mixin for shared formatting methods
	mixins: [format],
	data() {
		return {
			loading: false, // UI loading state
			pos_profile: "", // POS profile settings
			pos_settings: "", // POS settings
			invoice_doc: "", // Current invoice document
			invoiceType: "Invoice", // Type of invoice
			is_return: false, // Is this a return invoice?
			loyalty_amount: 0, // Loyalty points to redeem

			credit_change: 0, // Change to be given as credit
			paid_change: 0, // Change to be given as paid
			is_credit_sale: false, // Is this a credit sale?
			is_write_off_change: false, // Write-off for change enabled
			is_cashback: true, // Cashback enabled
			is_credit_return: false, // Is this a credit return?

			paid_change_rules: [], // Validation rules for paid change
			phone_dialog: false, // Show phone payment dialog
			custom_days_dialog: false, // Show custom days dialog
			custom_days_value: null, // Custom days entry
			new_delivery_date: null, // New delivery date value
			new_po_date: null, // New PO date value
			new_credit_due_date: null, // New credit due date value
			credit_due_days: null, // Number of days until due
			credit_due_presets: [7, 14, 30], // Preset options for due days
			customer_info: "", // Customer info
			mpesa_modes: [], // List of available M-Pesa modes
			sales_persons: [], // List of sales persons
			sales_person: "", // Selected sales person
			addresses: [], // List of customer addresses
			is_user_editing_paid_change: false, // User interaction flag
			shortPayHandler: null,
		};
	},
	computed: {
		// Get currency symbol for given or current currency
		currencySymbol() {
			return (currency) => {
				return get_currency_symbol(currency || this.invoice_doc.currency);
			};
		},
		// Display currency for invoice
		displayCurrency() {
			return this.invoice_doc ? this.invoice_doc.currency : "";
		},
		// Calculate total payments (all methods, loyalty, credit)
		total_payments() {
			// If credit sale is enabled, return 0 (no payments required)
			if (this.is_credit_sale || (this.invoice_doc && this.invoice_doc.is_credit_sale)) {
				console.log("Credit sale mode detected in total_payments - returning 0");
				return 0;
			}
			
			let total = 0;
			if (this.invoice_doc && this.invoice_doc.payments) {
				this.invoice_doc.payments.forEach((payment) => {
					// Payment amount is already in selected currency
					let amount = parseFloat(payment.amount) || 0;
					total += amount;
					console.log("total_payments - payment amount:", payment.amount, "parsed as:", amount);
				});
			}

			// Add loyalty amount (convert if needed)
			if (this.loyalty_amount) {
				// Loyalty points are stored in base currency (PKR)
				if (this.invoice_doc.currency !== this.pos_profile.currency) {
					// Convert to selected currency (e.g. USD) by dividing
					total += this.flt(
						this.loyalty_amount / (this.invoice_doc.conversion_rate || 1),
						this.currency_precision,
					);
				} else {
					total += parseFloat(this.loyalty_amount) || 0;
				}
			}

			// Don't round the total payments to avoid precision issues with F4 payments
			// The payment amounts are already set to exact values by F4 function
			console.log("Total payments calculated:", total);
			return total;
		},

		diff_payment() {
			if (!this.invoice_doc) return 0;

			// Customer should only pay the grand_total, not the rounded_total
			// The rounding adjustment should be handled by the system, not charged to customer
			// NOTE: With F4 shortcut fix, grand_total now equals rounded_total, so no outstanding amounts
			let invoice_total = this.invoice_doc.grand_total;

			let diff = invoice_total - this.total_payments;

			console.log("diff_payment - invoice_total (grand_total):", invoice_total);
			console.log("diff_payment - total_payments:", this.total_payments);
			console.log("diff_payment - diff:", diff);

			if (this.invoice_doc.is_return) {
				return diff >= 0 ? diff : 0;
			}

			return diff >= 0 ? diff : 0;
		},

		// Calculate change to be given back to customer
		credit_change() {
			// Customer should only pay the grand_total, not the rounded_total
			// The rounding adjustment should be handled by the system, not charged to customer
			let invoice_total = this.invoice_doc.grand_total;

			let change = this.total_payments - invoice_total;

			return change > 0 ? change : 0;
		},

		diff_label() {
			return this.diff_payment > 0
				? `To Be Paid (${this.displayCurrency})`
				: `Change (${this.displayCurrency})`;
		},
		total_payments_display() {
			return this.formatCurrency(this.total_payments, this.displayCurrency);
		},
		diff_payment_display() {
			return this.formatCurrency(this.diff_payment, this.displayCurrency);
		},
		available_points_amount() {
			let amount = 0;
			if (this.customer_info.loyalty_points) {
				amount = this.customer_info.loyalty_points * this.customer_info.conversion_factor;

				if (this.invoice_doc.currency !== this.pos_profile.currency) {
					amount = this.flt(
						amount / (this.invoice_doc.conversion_rate || 1),
						this.currency_precision,
					);
				}
			}
			return amount;
		},

		vaildatPayment() {
			if (this.pos_profile.posa_allow_sales_order) {
				if (this.invoiceType === "Order" && !this.invoice_doc.posa_delivery_date) {
					return true;
				}
			}
			return false;
		},
		request_payment_field() {
			return (
				this.pos_settings?.invoice_fields?.some(
					(el) => el.fieldtype === "Button" && el.fieldname === "request_for_payment",
				) || false
			);
		},
		isDarkTheme() {
			return this.$theme.current === "dark";
		},
	},
	watch: {
		loading(newVal) {
			this.eventBus.emit("payment_submission_loading", !!newVal);
		},
		diff_payment(newVal) {
			if (!this.is_user_editing_paid_change) {
				this.paid_change = -newVal;
			}
		},
		paid_change(newVal) {
			const changeLimit = -this.diff_payment;
			if (newVal > changeLimit) {
				this.paid_change = changeLimit;
				this.credit_change = 0;
				this.paid_change_rules = ["Paid change can not be greater than total change!"];
			} else {
				this.paid_change_rules = [];
				this.credit_change = this.flt(newVal - changeLimit, this.currency_precision);
			}
		},
		loyalty_amount(value) {
			if (value > this.available_points_amount) {
				this.invoice_doc.loyalty_amount = 0;
				this.invoice_doc.redeem_loyalty_points = 0;
				this.invoice_doc.loyalty_points = 0;
				this.loyalty_amount = 0;
				this.eventBus.emit("show_message", {
					title: `Loyalty Amount can not be more than ${this.available_points_amount}`,
					color: "error",
				});
			} else {
				this.invoice_doc.loyalty_amount = this.flt(this.loyalty_amount);
				this.invoice_doc.redeem_loyalty_points = 1;
				this.invoice_doc.loyalty_points =
					this.flt(this.loyalty_amount) / this.customer_info.conversion_factor;
			}
		},

		sales_person(newVal) {
			if (newVal) {
				this.invoice_doc.sales_team = [
					{
						sales_person: newVal,
						allocated_percentage: 100,
					},
				];
				console.log("Updated sales_team with sales_person:", newVal);
			} else {
				this.invoice_doc.sales_team = [];
				console.log("Cleared sales_team");
			}
		},
		is_credit_sale(newVal) {
			console.log("is_credit_sale watcher triggered:", newVal);
			if (newVal) {
				this.invoice_doc.payments.forEach((payment) => {
					payment.amount = 0;
					if (payment.base_amount !== undefined) {
						payment.base_amount = 0;
					}
				});
				this.invoice_doc.is_credit_sale = true;
				console.log("Credit sale enabled - all payments cleared");
			} else {
				this.invoice_doc.payments.forEach((payment) => {
					if (payment.mode_of_payment.toLowerCase() === "cash") {
						payment.amount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
					}
				});
				this.invoice_doc.is_credit_sale = false;
				console.log("Credit sale disabled - cash payment restored");
			}
			this.$forceUpdate();
		},
		is_credit_return(newVal) {
			if (newVal) {
				this.is_cashback = false;
				this.invoice_doc.payments.forEach((payment) => {
					payment.amount = 0;
					if (payment.base_amount !== undefined) {
						payment.base_amount = 0;
					}
				});
			} else {
				this.is_cashback = true;
				this.ensureReturnPaymentsAreNegative();
			}
		},
	},
	methods: {
		back_to_invoice() {
			this.eventBus.emit("show_payment", "false");
			this.eventBus.emit("set_customer_readonly", false);
		},
		reset_cash_payments() {
			this.invoice_doc.payments.forEach((payment) => {
				if (payment.mode_of_payment.toLowerCase() === "cash") {
					payment.amount = 0;
				}
			});
		},
		ensureReturnPaymentsAreNegative() {
			if (!this.invoice_doc || !this.invoice_doc.is_return || !this.is_cashback) {
				return;
			}
			let hasPaymentSet = false;
			this.invoice_doc.payments.forEach((payment) => {
				if (Math.abs(payment.amount) > 0) {
					hasPaymentSet = true;
				}
			});
			if (!hasPaymentSet) {
				const default_payment = this.invoice_doc.payments.find((payment) => payment.default === 1);
				if (default_payment) {
					const amount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
					default_payment.amount = -Math.abs(amount);
					if (default_payment.base_amount !== undefined) {
						default_payment.base_amount = -Math.abs(amount);
					}
				}
			}
			this.invoice_doc.payments.forEach((payment) => {
				if (payment.amount > 0) {
					payment.amount = -Math.abs(payment.amount);
				}
				if (payment.base_amount !== undefined && payment.base_amount > 0) {
					payment.base_amount = -Math.abs(payment.base_amount);
				}
			});
		},
		submit(event, payment_received = false, print = false) {
			if (this.loading) {
				return;
			}

			try {
			if (this.invoice_doc.is_return) {
				this.ensureReturnPaymentsAreNegative();
			}
			
			const is_credit_sale_mode = this.is_credit_sale || this.invoice_doc.is_credit_sale;
			
			if (
				!is_credit_sale_mode &&
				!this.invoice_doc.is_return &&
				this.total_payments <= 0 &&
				(this.invoice_doc.rounded_total || this.invoice_doc.grand_total) > 0
			) {
				console.log("Payment validation failed - showing error");
				this.eventBus.emit("show_message", {
					title: `Please enter payment amount`,
					color: "error",
				});
				frappe.utils.play_sound("error");
				return;
			}
			
			// For credit sales, ensure all payment amounts are 0
			if (is_credit_sale_mode) {
				console.log("Credit sale mode detected - clearing all payment amounts");
				this.invoice_doc.payments.forEach((payment) => {
					payment.amount = 0;
					if (payment.base_amount !== undefined) {
						payment.base_amount = 0;
					}
				});
				// Set credit sale flag on invoice
				this.invoice_doc.is_credit_sale = true;
			}
			
			// Validate cash payments when credit sale is off
			if (!is_credit_sale_mode && !this.invoice_doc.is_return) {
				let has_cash_payment = false;
				let cash_amount = 0;
				this.invoice_doc.payments.forEach((payment) => {
					if (payment.mode_of_payment.toLowerCase().includes("cash")) {
						has_cash_payment = true;
						cash_amount = this.flt(payment.amount);
					}
				});
				if (has_cash_payment && cash_amount > 0) {
					if (
						!this.pos_profile.posa_allow_partial_payment &&
						cash_amount < (this.invoice_doc.rounded_total || this.invoice_doc.grand_total) &&
						(this.invoice_doc.rounded_total || this.invoice_doc.grand_total) > 0
					) {
						this.eventBus.emit("show_message", {
							title: `Cash payment cannot be less than invoice total when partial payment is not allowed`,
							color: "error",
						});
						frappe.utils.play_sound("error");
						return;
					}
				}
			}
			// Validate partial payments only if not credit sale and invoice total is not zero
			// Add tolerance for floating point precision issues (0.0001 tolerance)
			const invoiceTotal = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
			const tolerance = 0.0001; // Very small tolerance for floating point precision
			const isPaymentComplete = this.total_payments >= (invoiceTotal - tolerance);
			
			if (
				!is_credit_sale_mode &&
				!this.pos_profile.posa_allow_partial_payment &&
				!isPaymentComplete &&
				invoiceTotal > 0
			) {
				console.log("Payment validation - Total payments:", this.total_payments);
				console.log("Payment validation - Invoice total:", invoiceTotal);
				console.log("Payment validation - Difference:", invoiceTotal - this.total_payments);
				console.log("Payment validation - Tolerance:", tolerance);
				
				this.eventBus.emit("show_message", {
					title: `The amount paid is not complete`,
					color: "error",
				});
				frappe.utils.play_sound("error");
				return;
			}
			// Validate phone payment
			let phone_payment_is_valid = true;
			if (!payment_received) {
				this.invoice_doc.payments.forEach((payment) => {
					if (payment.type === "Phone" && ![0, "0", "", null, undefined].includes(payment.amount)) {
						phone_payment_is_valid = false;
					}
				});
				if (!phone_payment_is_valid) {
					this.eventBus.emit("show_message", {
						title: __("Please request phone payment or use another payment method"),
						color: "error",
					});
					frappe.utils.play_sound("error");
					return;
				}
			}
			// Validate paid_change
			if (this.paid_change > -this.diff_payment) {
				this.eventBus.emit("show_message", {
					title: `Paid change cannot be greater than total change!`,
					color: "error",
				});
				frappe.utils.play_sound("error");
				return;
			}
			// Validate cashback
			let total_change = this.flt(this.flt(this.paid_change) + this.flt(-this.credit_change));
			if (this.is_cashback && total_change !== -this.diff_payment) {
				this.eventBus.emit("show_message", {
					title: `Error in change calculations!`,
					color: "error",
				});
				frappe.utils.play_sound("error");
				return;
			}


							// Proceed to submit the invoice
				this.loading = true;
				
				// Safety timeout to reset loading if something goes wrong
				setTimeout(() => {
					if (this.loading) {
						console.warn("Safety timeout - resetting loading state");
						this.loading = false;
						this.eventBus.emit("show_message", {
							title: __("Submission timeout. Please try again."),
							color: "warning",
						});
					}
				}, 60000); // 60 seconds safety timeout
				
				this.submit_invoice(print);
			} catch (error) {
				console.error("Error in submit method:", error);
				this.eventBus.emit("show_message", {
					title: `Error during submission: ${error.message}`,
					color: "error",
				});
				this.loading = false;
				frappe.utils.play_sound("error");
			}
		},
		// Submit invoice to backend after all validations
		submit_invoice(print) {
			const vm = this;
			if (!vm.loading) {
				vm.loading = true;
			}
			
			// Ensure loading state is reset on any error
			const resetLoading = () => {
				console.log("Resetting loading state");
				vm.loading = false;
			};
			
			// Set a timeout to reset loading state if request takes too long
			const loadingTimeout = setTimeout(() => {
				console.warn("Request timeout - resetting loading state");
				resetLoading();
				vm.eventBus.emit("show_message", {
					title: __("Request timeout. Please try again."),
					color: "warning",
				});
			}, 30000); // 30 seconds timeout
			// For return invoices, ensure payments are negative one last time
			if (this.invoice_doc.is_return) {
				this.ensureReturnPaymentsAreNegative();
			}
			let totalPayedAmount = 0;
			this.invoice_doc.payments.forEach((payment) => {
				payment.amount = this.flt(payment.amount);
				totalPayedAmount += payment.amount;
			});
			if (this.invoice_doc.is_return && totalPayedAmount === 0) {
				this.invoice_doc.is_pos = 0;
			}
			
			// Ensure is_pos is set correctly for credit sales
			if (this.is_credit_sale) {
				this.invoice_doc.is_pos = 1;
			}
			
			let data = {
				total_change: !this.invoice_doc.is_return ? -this.diff_payment : 0,
				paid_change: !this.invoice_doc.is_return ? this.paid_change : 0,
				credit_change: -this.credit_change,
				is_cashback: this.is_cashback,
				is_credit_sale: this.is_credit_sale, // Add credit sale flag to data
			};

			if (isOffline()) {
				try {
					saveOfflineInvoice({ data: data, invoice: this.invoice_doc });
					this.eventBus.emit("pending_invoices_changed", getPendingOfflineInvoiceCount());
					vm.eventBus.emit("show_message", {
						title: __("Invoice saved offline"),
						color: "warning",
					});
					if (print) {
						this.print_offline_invoice(this.invoice_doc);
					}
					vm.eventBus.emit("clear_invoice");
					vm.eventBus.emit("reset_posting_date");
					vm.back_to_invoice();
					vm.loading = false;
					return;
				} catch (error) {
					vm.eventBus.emit("show_message", {
						title: __("Cannot Save Offline Invoice: ") + (error.message || __("Unknown error")),
						color: "error",
					});
					vm.loading = false;
					return;
				}
			}
			frappe.call({
				method:
					this.invoiceType === "Order" && this.pos_profile.posa_create_only_sales_order
						? "posawesome.posawesome.api.sales_orders.submit_sales_order"
						: "posawesome.posawesome.api.invoices.submit_invoice",
				args: {
					data: data,
					invoice: this.invoice_doc,
					order: this.invoice_doc,
				},
				callback: function (r) {
					// Clear the timeout since we got a response
					clearTimeout(loadingTimeout);
					
					// Always reset loading state first
					vm.loading = false;
					
					if (r.exc) {
						console.error("Error submitting invoice:", r.exc);
						// Show detailed error message to help debugging
						let errorMsg = r.exc.toString();
						if (errorMsg.includes("Amount must be negative")) {
							vm.eventBus.emit("show_message", {
								title: __("Fixing payment amounts for return invoice..."),
								color: "warning",
							});
							// Force fix the amounts
							vm.invoice_doc.payments.forEach((payment) => {
								if (payment.amount > 0) {
									payment.amount = -Math.abs(payment.amount);
								}
								if (payment.base_amount > 0) {
									payment.base_amount = -Math.abs(payment.base_amount);
								}
							});
							// Retry submission once
							console.log("Retrying submission with fixed payment amounts");
							setTimeout(() => {
								vm.submit_invoice(print);
							}, 500);
						} else {
							vm.eventBus.emit("show_message", {
								title: __("Error submitting invoice: ") + errorMsg,
								color: "error",
							});
						}
						return;
					}
					if (!r.message) {
						vm.eventBus.emit("show_message", {
							title: __("Error submitting invoice: No response from server"),
							color: "error",
						});
						return;
					}
					if (print) {
						console.log("==========================================");
						console.log("ONLINE PRINT: Calling load_print_page() for SERVER print format");
						console.log("==========================================");
						const serverInvoiceName =
							(r.message && (r.message.name || r.message.invoice_name)) || null;
						const invoiceName = serverInvoiceName || vm.invoice_doc?.name;
						if (!invoiceName) {
							console.warn("No invoice name returned from server; skipping print.");
						} else {
							vm.invoice_doc.name = invoiceName;
							vm.load_print_page(invoiceName);
						}
					}
					vm.is_cashback = true;
					vm.is_credit_return = false;
					vm.sales_person = "";
					vm.eventBus.emit("set_last_invoice", vm.invoice_doc.name);
					vm.eventBus.emit("show_message", {
						title:
							vm.invoiceType === "Order" && vm.pos_profile.posa_create_only_sales_order
								? __("Sales Order {0} is Submitted", [r.message.name])
								: __("Invoice {0} is Submitted", [r.message.name]),
						color: "success",
					});
					frappe.utils.play_sound("submit");
					// Update local stock quantities immediately after successful
					// invoice submission so item availability reflects changes
					updateLocalStock(vm.invoice_doc.items || []);
					vm.addresses = [];
					vm.eventBus.emit("clear_invoice");
					vm.eventBus.emit("reset_posting_date");
					vm.back_to_invoice();
					resetLoading();
				},
			});
		},
		// Reset loading state - can be called from anywhere
		resetLoadingState() {
			console.log("Resetting loading state via resetLoadingState method");
			this.loading = false;
		},
		// Force reset loading state - for debugging
		forceResetLoading() {
			console.log("Force resetting loading state");
			this.loading = false;
			this.eventBus.emit("show_message", {
				title: __("Loading state manually reset"),
				color: "info",
			});
		},
		// Set full amount for a payment method (or negative for returns)
		set_full_amount(selectedPayment) {
			if (!selectedPayment || !this.invoice_doc?.payments?.length) {
				return;
			}

			const isReturn = this.invoice_doc.is_return || this.invoiceType === "Return";
			let totalAmount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;

			console.log("Setting full amount for payment method:", selectedPayment.mode_of_payment);
			console.log("Current payments:", JSON.stringify(this.invoice_doc.payments));

			// Reset all payment amounts first
			this.invoice_doc.payments.forEach((payment) => {
				payment.amount = 0;
				if (payment.base_amount !== undefined) {
					payment.base_amount = 0;
				}
			});

			// Set amount only for the clicked payment method
			const clickedPayment = this.invoice_doc.payments.find((payment) => {
				if (selectedPayment.name && payment.name) {
					return payment.name === selectedPayment.name;
				}

				if (
					selectedPayment.idx !== undefined &&
					selectedPayment.idx !== null &&
					payment.idx !== undefined &&
					payment.idx !== null
				) {
					return String(payment.idx) === String(selectedPayment.idx);
				}

				return payment.mode_of_payment === selectedPayment.mode_of_payment;
			});

			if (clickedPayment) {
				console.log("Found clicked payment:", clickedPayment.mode_of_payment);
				let amount = isReturn ? -Math.abs(totalAmount) : totalAmount;
				clickedPayment.amount = amount;
				if (clickedPayment.base_amount !== undefined) {
					clickedPayment.base_amount = isReturn ? -Math.abs(amount) : amount;
				}
				console.log("Set amount for payment:", clickedPayment.mode_of_payment, "amount:", amount);
			} else {
				console.log("No payment found for selected payment:", selectedPayment);
			}

			// Force Vue to update the view
			this.$forceUpdate();
		},
		// Set remaining amount for a payment method when focused
		set_rest_amount(selectedPayment) {
			if (!selectedPayment || !this.invoice_doc?.payments?.length) {
				return;
			}

			const isReturn = this.invoice_doc.is_return || this.invoiceType === "Return";

			const targetPayment = this.invoice_doc.payments.find((payment) => {
				if (selectedPayment.name && payment.name) {
					return payment.name === selectedPayment.name;
				}

				if (
					selectedPayment.idx !== undefined &&
					selectedPayment.idx !== null &&
					payment.idx !== undefined &&
					payment.idx !== null
				) {
					return String(payment.idx) === String(selectedPayment.idx);
				}

				return payment.mode_of_payment === selectedPayment.mode_of_payment;
			});

			if (!targetPayment) {
				return;
			}

			// Defer to let blur/change updates on previous field settle first.
			this.$nextTick(() => {
				if (this.flt(targetPayment.amount) !== 0) {
					return;
				}

				if (this.diff_payment <= 0) {
					return;
				}

				let amount = this.flt(this.diff_payment, this.currency_precision);
				if (isReturn) {
					amount = -Math.abs(amount);
				}

				targetPayment.amount = amount;
				if (targetPayment.base_amount !== undefined) {
					targetPayment.base_amount = isReturn ? -Math.abs(amount) : amount;
				}

				this.$forceUpdate();
			});
		},
		// Clear all payment amounts
		clear_all_amounts() {
			this.invoice_doc.payments.forEach((payment) => {
				payment.amount = 0;
			});
		},
		// Open print page for invoice - optimised for faster printing
		async load_print_page(invoiceName) {
			const targetInvoiceName = invoiceName || this.invoice_doc?.name;
			if (!targetInvoiceName) return;
			const print_format = this.pos_profile.print_format || "SALES POS";
			const no_letterhead = this.pos_profile?.letter_head ? 0 : 1;
			const printOptions = {
				invoiceDoc: { ...(this.invoice_doc || {}), name: targetInvoiceName },
				allowOfflineFallback: true,
				fallbackDelay: 4000,
			};

			// Always use silent print - no separate print preview window
			silentPrint(
				{
					doctype: "Sales Invoice",
					name: targetInvoiceName,
					print_format,
					no_letterhead,
					use_print_preview_overlay: !!this.pos_profile?.posa_enable_print_preview_overlay,
				},
				printOptions,
			);
		},
		// Print invoice using a more detailed offline template
		print_offline_invoice(invoice) {
			if (!invoice) return;
			
			// Debug information
			console.log('Printing offline invoice:', invoice.name);
			console.log('POS Profile:', this.pos_profile);
			console.log('Print Format from POS Profile:', this.pos_profile?.print_format);
			console.log('POS Profile Name:', this.pos_profile?.name);
			console.log('Company:', this.pos_profile?.company);
			
			// Test: Force use of POS Print format for testing
			if (!this.pos_profile?.print_format) {
				console.log('No print format found in POS Profile, using default format');
			} else {
				console.log('Print format found:', this.pos_profile.print_format);
			}
			
			const html = generateOfflineInvoiceHTML(invoice, this.pos_profile);
			const win = window.open("", "_blank");
			win.document.write(html);
			win.document.close();
			win.focus();
			win.print();
		},
		// Validate due date (should not be in the past)
		validate_due_date() {
			const today = frappe.datetime.now_date();
			const new_date = Date.parse(this.invoice_doc.due_date);
			const parse_today = Date.parse(today);
			if (new_date < parse_today) {
				this.invoice_doc.due_date = today;
			}
		},
		// Keyboard shortcut for payment submit (Ctrl+X)
		shortPay(e) {
			if (e.key.toLowerCase() === "x" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				e.stopPropagation();
				if (this.loading) {
					return;
				}
				if (this.invoice_doc && this.invoice_doc.payments) {
					this.submit();
				}
			}
		},
		// Method to set cash payment and print (for F4 shortcut)
		setCashPaymentAndPrint() {
			if (this.loading) {
				return;
			}

			console.log("setCashPaymentAndPrint method called");
			console.log("Invoice doc:", this.invoice_doc);
			console.log("Payments:", this.invoice_doc?.payments);
			
			if (!this.invoice_doc || !this.invoice_doc.payments) {
				console.log("No invoice doc or payments found - returning");
				return;
			}

			// Customer should only pay the grand_total, not the rounded_total
			// The rounding adjustment should be handled by the system, not charged to customer
			let invoiceTotal = this.invoice_doc.grand_total || 0;
			
			console.log("F4 - Grand Total:", this.invoice_doc.grand_total);
			console.log("F4 - Rounded Total:", this.invoice_doc.rounded_total);
			console.log("F4 - Using invoiceTotal (grand_total):", invoiceTotal);
			
			// Set cash payment to the grand_total amount (what customer actually owes)
			this.invoice_doc.payments.forEach((payment) => {
				if (payment.mode_of_payment.toLowerCase().includes("cash")) {
					console.log("F4 - Setting cash payment from", payment.amount, "to", invoiceTotal);
					payment.amount = parseFloat(invoiceTotal);
					payment.base_amount = parseFloat(invoiceTotal);
				} else {
					payment.amount = 0;
					payment.base_amount = 0;
				}
			});

			// Keep the original values - don't override grand_total or rounded_total
			// The outstanding_amount will be calculated correctly by the system
			console.log("F4 - Keeping original grand_total:", this.invoice_doc.grand_total);
			console.log("F4 - Keeping original rounded_total:", this.invoice_doc.rounded_total);

			console.log("F4 - Total payments after setting:", this.total_payments);
			console.log("F4 - Diff payment after setting:", this.diff_payment);
			console.log("F4 - Invoice grand_total after setting:", this.invoice_doc.grand_total);
			console.log("F4 - Invoice rounded_total after setting:", this.invoice_doc.rounded_total);

			// Update the display
			this.$forceUpdate();

			// Submit with print after a short delay
			setTimeout(() => {
				this.submit(undefined, false, true);
			}, 200);
		},

		// Get customer addresses for shipping
		get_addresses() {
			const vm = this;
			if (!vm.invoice_doc || !vm.invoice_doc.customer) {
				vm.addresses = [];
				return;
			}
			frappe.call({
				method: "posawesome.posawesome.api.customers.get_customer_addresses",
				args: { customer: vm.invoice_doc.customer },
				async: true,
				callback: function (r) {
					if (!r.exc) {
						vm.addresses = r.message;
					} else {
						vm.addresses = [];
					}
				},
			});
		},
		// Filter addresses for autocomplete
		addressFilter(item, queryText, itemText) {
			const searchText = queryText.toLowerCase();
			return (
				(item.address_title && item.address_title.toLowerCase().includes(searchText)) ||
				(item.address_line1 && item.address_line1.toLowerCase().includes(searchText)) ||
				(item.address_line2 && item.address_line2.toLowerCase().includes(searchText)) ||
				(item.city && item.city.toLowerCase().includes(searchText)) ||
				(item.name && item.name.toLowerCase().includes(searchText))
			);
		},
		// Open dialog to add new address
		new_address() {
			if (!this.invoice_doc || !this.invoice_doc.customer) {
				this.eventBus.emit("show_message", {
					title: __("Please select a customer first"),
					color: "error",
				});
				return;
			}
			this.eventBus.emit("open_new_address", this.invoice_doc.customer);
		},
		// Get sales person names from API/localStorage
		get_sales_person_names() {
			const vm = this;
			if (vm.pos_profile.posa_local_storage && getSalesPersonsStorage().length) {
				try {
					vm.sales_persons = getSalesPersonsStorage();
				} catch (e) {}
			}
			frappe.call({
				method: "posawesome.posawesome.api.utilities.get_sales_person_names",
				callback: function (r) {
					if (r.message && r.message.length > 0) {
						vm.sales_persons = r.message.map((sp) => ({
							value: sp.name,
							title: sp.sales_person_name,
							sales_person_name: sp.sales_person_name,
							name: sp.name,
						}));
						if (vm.pos_profile.posa_local_storage) {
							setSalesPersonsStorage(vm.sales_persons);
						}
					} else {
						vm.sales_persons = [];
					}
				},
			});
		},
		// Request payment for phone type
		request_payment(payment) {
			this.phone_dialog = false;
			const vm = this;
			if (!this.invoice_doc.contact_mobile) {
				this.eventBus.emit("show_message", {
					title: __("Please set the customer's mobile number"),
					color: "error",
				});
				this.eventBus.emit("open_edit_customer");
				this.back_to_invoice();
				return;
			}
			this.eventBus.emit("freeze", { title: __("Waiting for payment...") });
			this.invoice_doc.payments.forEach((payment) => {
				payment.amount = this.flt(payment.amount);
			});
			let formData = { ...this.invoice_doc };
			formData["total_change"] = !this.invoice_doc.is_return ? -this.diff_payment : 0;
			formData["paid_change"] = !this.invoice_doc.is_return ? this.paid_change : 0;
			formData["credit_change"] = -this.credit_change;

			formData["is_cashback"] = this.is_cashback;
			frappe
				.call({
					method: "posawesome.posawesome.api.invoices.update_invoice",
					args: { data: formData },
					async: false,
					callback: function (r) {
						if (r.message) {
							vm.invoice_doc = r.message;
						}
					},
				})
				.then(() => {
					frappe
						.call({
							method: "posawesome.posawesome.api.payments.create_payment_request",
							args: { doc: vm.invoice_doc },
						})
						.fail(() => {
							vm.eventBus.emit("unfreeze");
							vm.eventBus.emit("show_message", {
								title: __("Payment request failed"),
								color: "error",
							});
						})
						.then(({ message }) => {
							const payment_request_name = message.name;
							setTimeout(() => {
								frappe.db
									.get_value("Payment Request", payment_request_name, [
										"status",
										"grand_total",
									])
									.then(({ message }) => {
										if (message.status !== "Paid") {
											vm.eventBus.emit("unfreeze");
											vm.eventBus.emit("show_message", {
												title: __(
													"Payment Request took too long to respond. Please try requesting for payment again",
												),
												color: "error",
											});
										} else {
											vm.eventBus.emit("unfreeze");
											vm.eventBus.emit("show_message", {
												title: __("Payment of {0} received successfully.", [
													vm.formatCurrency(
														message.grand_total,
														vm.invoice_doc.currency,
														0,
													),
												]),
												color: "success",
											});
											frappe.db
												.get_doc("Sales Invoice", vm.invoice_doc.name)
												.then((doc) => {
													vm.invoice_doc = doc;
													vm.submit(null, true);
												});
										}
									});
							}, 30000);
						});
				});
		},
		// Get M-Pesa payment modes from backend
		get_mpesa_modes() {
			const vm = this;
			frappe.call({
				method: "posawesome.posawesome.api.m_pesa.get_mpesa_mode_of_payment",
				args: { company: vm.pos_profile.company },
				async: true,
				callback: function (r) {
					if (!r.exc) {
						vm.mpesa_modes = r.message;
					} else {
						vm.mpesa_modes = [];
					}
				},
			});
		},
		is_mpesa_c2b_payment(payment) {
			if (this.mpesa_modes.includes(payment.mode_of_payment) && payment.type === "Bank") {
				payment.amount = 0;
				return true;
			} else {
				return false;
			}
		},
		mpesa_c2b_dialog(payment) {
			const data = {
				company: this.pos_profile.company,
				mode_of_payment: payment.mode_of_payment,
				customer: this.invoice_doc.customer,
			};
			this.eventBus.emit("open_mpesa_payments", data);
		},
		set_mpesa_payment(payment) {
			this.pos_profile.use_customer_credit = true;
			this.redeem_customer_credit = true;
			const invoiceAmount = this.invoice_doc.rounded_total || this.invoice_doc.grand_total;
			let amount =
				payment.unallocated_amount > invoiceAmount ? invoiceAmount : payment.unallocated_amount;
			amount = amount > 0 ? amount : 0;
			const advance = {
				type: "Advance",
				credit_origin: payment.name,
				total_credit: this.flt(payment.unallocated_amount),
				credit_to_redeem: this.flt(amount),
			};
			this.clear_all_amounts();
			this.customer_credit_dict.push(advance);
		},
		update_delivery_date() {
			this.invoice_doc.posa_delivery_date = this.formatDate(this.new_delivery_date);
			// After setting delivery date, fetch addresses if not already loaded
			if (this.invoice_doc.customer && (!this.addresses || this.addresses.length === 0)) {
				this.get_addresses();
			}
		},
		update_po_date() {
			this.invoice_doc.po_date = this.formatDate(this.new_po_date);
		},
		update_credit_due_date() {
			this.invoice_doc.due_date = this.formatDate(this.new_credit_due_date);
		},
		applyDuePreset(days) {
			if (days === null || days === "" || isNaN(days)) {
				return;
			}
			const d = new Date();
			d.setDate(d.getDate() + parseInt(days, 10));
			this.new_credit_due_date = this.formatDateDisplay(d);
			this.credit_due_days = parseInt(days, 10);
			this.update_credit_due_date();
		},
		applyCustomDays() {
			this.applyDuePreset(this.custom_days_value);
			this.custom_days_dialog = false;
		},
		formatDate(date) {
			if (!date) return null;
			if (typeof date === "string") {
				if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					return date;
				}
				if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(date)) {
					const [d, m, y] = date.split("-");
					return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
				}
			}
			const d = new Date(date);
			if (!isNaN(d.getTime())) {
				const year = d.getFullYear();
				const month = `0${d.getMonth() + 1}`.slice(-2);
				const day = `0${d.getDate()}`.slice(-2);
				return `${year}-${month}-${day}`;
			}
			return date;
		},

		formatDateDisplay(date) {
			if (!date) return "";
			if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
				const [y, m, d] = date.split("-");
				return `${d}-${m}-${y}`;
			}
			const d = new Date(date);
			if (!isNaN(d.getTime())) {
				const year = d.getFullYear();
				const month = `0${d.getMonth() + 1}`.slice(-2);
				const day = `0${d.getDate()}`.slice(-2);
				return `${day}-${month}-${year}`;
			}
			return date;
		},
		showPaidAmount() {
			this.eventBus.emit("show_message", {
				title: `Total Paid Amount: ${this.formatCurrency(this.total_payments)}`,
				color: "info",
			});
		},
		showDiffPayment() {
			if (!this.invoice_doc) return;
			this.eventBus.emit("show_message", {
				title: `To Be Paid: ${this.formatCurrency(this.diff_payment)}`,
				color: "info",
			});
		},
		showPaidChange() {
			this.eventBus.emit("show_message", {
				title: `Paid Change: ${this.formatCurrency(this.paid_change)}`,
				color: "info",
			});
		},
		showCreditChange(value) {
			if (value > 0) {
				this.credit_change = value;
				this.paid_change = -this.diff_payment;
			} else {
				this.credit_change = 0;
			}
		},
		formatCurrency(value) {
			return this.$options.mixins[0].methods.formatCurrency.call(this, value, this.currency_precision);
		},
		get_change_amount() {
			return Math.max(0, this.total_payments - this.invoice_doc.grand_total);
		},
		async syncPendingInvoices() {
			const pending = getPendingOfflineInvoiceCount();
			if (pending) {
				this.eventBus.emit("show_message", {
					title: `${pending} invoice${pending > 1 ? "s" : ""} pending for sync`,
					color: "warning",
				});
				this.eventBus.emit("pending_invoices_changed", pending);
			}
			if (isOffline()) {
				return;
			}
			const result = await syncOfflineInvoices();
			if (result && (result.synced || result.drafted)) {
				if (result.synced) {
					this.eventBus.emit("show_message", {
						title: `${result.synced} offline invoice${result.synced > 1 ? "s" : ""} synced`,
						color: "success",
					});
				}
				if (result.drafted) {
					this.eventBus.emit("show_message", {
						title: `${result.drafted} offline invoice${result.drafted > 1 ? "s" : ""} saved as draft`,
						color: "warning",
					});
				}
			}
			this.eventBus.emit("pending_invoices_changed", getPendingOfflineInvoiceCount());
		},
		handleCreditSaleToggle() {
			console.log("Credit sale toggled:", this.is_credit_sale);
			
			if (this.invoice_doc) {
				this.invoice_doc.is_credit_sale = this.is_credit_sale;
				console.log("Invoice credit sale flag set to:", this.invoice_doc.is_credit_sale);
			}
			
			if (this.is_credit_sale && this.invoice_doc && this.invoice_doc.payments) {
				this.invoice_doc.payments.forEach((payment) => {
					payment.amount = 0;
					if (payment.base_amount !== undefined) {
						payment.base_amount = 0;
					}
				});
				console.log("All payment amounts cleared for credit sale");
			}
		},

	},
	// Lifecycle hook: created
	created() {
		this.shortPayHandler = this.shortPay;
		document.addEventListener("keydown", this.shortPayHandler);
		this.syncPendingInvoices();
		this.eventBus.on("network-online", this.syncPendingInvoices);
		this.eventBus.on("server-online", this.syncPendingInvoices);
		this.eventBus.on("register_pos_profile", (data) => {
			this.pos_profile = data.pos_profile;
		});
		this.eventBus.on("register_pos_settings", (data) => {
			this.pos_settings = data;
		});
		this.eventBus.on("register_invoice", (data) => {
			this.invoice_doc = data;
			this.invoiceType = data.doctype === "Sales Order" ? "Order" : "Invoice";
			this.is_return = data.is_return;
			this.get_addresses();
			this.get_sales_persons();
			this.fetch_customer_balance();
		});
		this.eventBus.on("register_customer_info", (data) => {
			this.customer_info = data;
		});
	},
	mounted() {
		this.$nextTick(() => {
			this.eventBus.on("send_invoice_doc_payment", (invoice_doc) => {
				this.invoice_doc = invoice_doc;
				const default_payment = this.invoice_doc.payments.find((payment) => payment.default === 1);
				this.is_credit_sale = false;
				this.is_write_off_change = false;
				if (invoice_doc.is_return) {
					this.is_return = true;
					this.is_credit_return = false;
					invoice_doc.payments.forEach((payment) => {
						payment.amount = 0;
						payment.base_amount = 0;
					});
					if (default_payment) {
						const amount = invoice_doc.rounded_total || invoice_doc.grand_total;
						default_payment.amount = -Math.abs(amount);
						if (default_payment.base_amount !== undefined) {
							default_payment.base_amount = -Math.abs(amount);
						}
					}
				} else if (default_payment) {
					default_payment.amount = this.flt(
						invoice_doc.rounded_total || invoice_doc.grand_total,
						this.currency_precision,
					);
					this.is_credit_return = false;
				}
				this.loyalty_amount = 0;
				
				// Focus on cash payment field after a short delay
				setTimeout(() => {
					this.focusCashPaymentField();
				}, 120);
				
				if (invoice_doc.customer) {
					this.get_addresses();
				}
				this.get_sales_person_names();
			});
			this.eventBus.on("show_payment", (visible) => {
				if (visible === "true") {
					this.$nextTick(() => {
						setTimeout(() => {
							this.focusCashPaymentField();
						}, 50);
					});
				}
			});
			this.eventBus.on("register_pos_profile", (data) => {
				this.pos_profile = data.pos_profile;
				this.get_mpesa_modes();
			});
			this.eventBus.on("add_the_new_address", (data) => {
				this.addresses.push(data);
				this.$forceUpdate();
			});
			this.eventBus.on("update_invoice_type", (data) => {
				this.invoiceType = data;
				if (this.invoice_doc && data !== "Order") {
					this.invoice_doc.posa_delivery_date = null;
					this.invoice_doc.posa_notes = null;
					this.invoice_doc.shipping_address_name = null;
				} else if (this.invoice_doc && data === "Order") {
					// Initialize delivery date to today when switching to Order type
					this.new_delivery_date = this.formatDateDisplay(frappe.datetime.now_date());
					this.update_delivery_date();
				}
				// Handle return invoices properly
				if (this.invoice_doc && data === "Return") {
					this.invoice_doc.is_return = 1;
					// Ensure payments are negative for returns
					this.ensureReturnPaymentsAreNegative();
					this.is_credit_return = false;
				}
			});
			this.eventBus.on("update_customer", (customer) => {
				if (this.customer !== customer) {
					this.is_cashback = true;
					this.is_credit_return = false;
				}
			});
			this.eventBus.on("set_pos_settings", (data) => {
				this.pos_settings = data;
			});
			this.eventBus.on("set_customer_info_to_edit", (data) => {
				this.customer_info = data;
			});
			this.eventBus.on("set_mpesa_payment", (data) => {
				this.set_mpesa_payment(data);
			});
			// Clear any stored invoice when parent emits clear_invoice
			this.eventBus.on("clear_invoice", () => {
				this.invoice_doc = "";
				this.is_return = false;
				this.is_credit_return = false;
			});
			// Handle submit with print event from shortcuts
			this.eventBus.on("submit_with_print", () => {
				this.submit(undefined, false, true);
			});
			// Handle cash payment and print event from F4 shortcut
			this.eventBus.on("set_cash_payment_and_print", () => {
				console.log("F4 event received in Payments.vue - calling setCashPaymentAndPrint");
				this.setCashPaymentAndPrint();
			});
			
			// Global error handler to ensure loading state is reset
			window.addEventListener('error', (event) => {
				console.error('Global error caught:', event.error);
				if (this.loading) {
					console.log('Resetting loading state due to global error');
					this.loading = false;
				}
			});
			
			// Handle unhandled promise rejections
			window.addEventListener('unhandledrejection', (event) => {
				console.error('Unhandled promise rejection:', event.reason);
				if (this.loading) {
					console.log('Resetting loading state due to unhandled promise rejection');
					this.loading = false;
				}
			});
			
			// Expose reset method globally for debugging
			window.resetPOSLoading = () => {
				if (this && this.forceResetLoading) {
					this.forceResetLoading();
				} else {
					console.log("POS component not available");
				}
			};
		});
	},
	// Lifecycle hook: beforeUnmount
	beforeUnmount() {
		this.eventBus.off("register_pos_profile");
		this.eventBus.off("register_pos_settings");
		this.eventBus.off("register_invoice");
		this.eventBus.off("register_customer_info");
		this.eventBus.off("show_payment");
		this.eventBus.off("submit_with_print");
		this.eventBus.off("set_cash_payment_and_print");
	},
	
	/**
	 * Focus on the cash payment field when payment page opens
	 */
	focusCashPaymentField(attempt = 0) {
		try {
			// Find the cash payment field by looking for input with cash payment mode
			const cashPaymentInput = document.querySelector('input[data-mode-of-payment*="cash" i], input[data-mode-of-payment*="Cash" i]');
			if (cashPaymentInput) {
				cashPaymentInput.focus();
				cashPaymentInput.select();
				return;
			}

			// Fallback: focus on the first payment input field
			const firstPaymentInput = document.querySelector('.payments input[type="text"]');
			if (firstPaymentInput) {
				firstPaymentInput.focus();
				firstPaymentInput.select();
				return;
			}

			if (attempt < 8) {
				setTimeout(() => this.focusCashPaymentField(attempt + 1), 80);
			}
		} catch (error) {
			console.warn("Could not focus on cash payment field:", error);
		}
	},
	
	// Lifecycle hook: unmounted
	unmounted() {
		// Remove keyboard shortcut listener
		if (this.shortPayHandler) {
			document.removeEventListener("keydown", this.shortPayHandler);
			this.shortPayHandler = null;
		}
	},
};
</script>

<style scoped>
.v-text-field {
	composes: pos-form-field;
}

/* Remove readonly styling */
.v-text-field--readonly {
	cursor: text;
}

.v-text-field--readonly:hover {
	background-color: transparent;
}

.cards {
	background-color: var(--surface-secondary) !important;
}

/* Dark mode styling for input fields */
:deep(.dark-theme) .dark-field,
:deep(.v-theme--dark) .dark-field,
::v-deep(.dark-theme) .dark-field,
::v-deep(.v-theme--dark) .dark-field {
	background-color: #1e1e1e !important;
}

:deep(.dark-theme) .dark-field :deep(.v-field__input),
:deep(.v-theme--dark) .dark-field :deep(.v-field__input),
:deep(.dark-theme) .dark-field :deep(input),
:deep(.v-theme--dark) .dark-field :deep(input),
:deep(.dark-theme) .dark-field :deep(.v-label),
:deep(.v-theme--dark) .dark-field :deep(.v-label),
::v-deep(.dark-theme) .dark-field .v-field__input,
::v-deep(.v-theme--dark) .dark-field .v-field__input,
::v-deep(.dark-theme) .dark-field input,
::v-deep(.v-theme--dark) .dark-field input,
::v-deep(.dark-theme) .dark-field .v-label,
::v-deep(.v-theme--dark) .dark-field .v-label {
	color: #fff !important;
}

:deep(.dark-theme) .dark-field :deep(.v-field__overlay),
:deep(.v-theme--dark) .dark-field :deep(.v-field__overlay),
::v-deep(.dark-theme) .dark-field .v-field__overlay,
::v-deep(.v-theme--dark) .dark-field .v-field__overlay {
	background-color: #1e1e1e !important;
}


</style>
