import { clearPriceListCache } from "../../../offline/index.js";

export default {
	// Watch for customer change and update related data
	customer() {
		this.close_payments();
		this.eventBus.emit("set_customer", this.customer);
		this.fetch_customer_details();
		this.fetch_customer_balance();
		this.set_delivery_charges();
	},
	// Watch for customer_info change and emit to edit form
	customer_info() {
		this.eventBus.emit("set_customer_info_to_edit", this.customer_info);
	},
	// Watch for expanded row change and update item detail
	expanded(data_value) {
		if (data_value.length > 0) {
			this.update_item_detail(data_value[0]);
		}
	},
	// Watch for discount offer name change and emit
	discount_percentage_offer_name() {
		this.eventBus.emit("update_discount_percentage_offer_name", {
			value: this.discount_percentage_offer_name,
		});
	},
	// Watch for items array changes (deep) and re-handle offers
	items: {
		deep: true,
		handler(items) {
			this.handelOffers();
			this.$forceUpdate();
		},
	},
	// Watch for invoice type change and emit
	invoiceType() {
		this.eventBus.emit("update_invoice_type", this.invoiceType);
	},
	// Watch for additional discount and update percentage accordingly
	additional_discount() {
		if (!this.additional_discount || this.additional_discount == 0) {
			this.additional_discount_percentage = 0;
		} else if (this.pos_profile.posa_use_percentage_discount) {
			// Prevent division by zero which causes NaN
			if (this.Total && this.Total !== 0) {
				this.additional_discount_percentage = (this.additional_discount / this.Total) * 100;
			} else {
				this.additional_discount_percentage = 0;
			}
		} else {
			this.additional_discount_percentage = 0;
		}
	},
	// Keep display date in sync with posting_date
	posting_date: {
		handler(newVal) {
			this.posting_date_display = this.formatDateForDisplay(newVal);
		},
		immediate: true,
	},
	// Update posting_date when user changes the display value
	posting_date_display(newVal) {
		this.posting_date = this.formatDateForBackend(newVal);
	},

	selected_price_list(newVal) {
		// Clear cached price list items to avoid mixing rates
		clearPriceListCache();

		// Apply the selected price list (not the customer price list)
		// The get_price_list() method will handle priority: customer > selected > default
		const applied = newVal || this.pos_profile.selling_price_list;

		// Emit event to ItemsSelector to update loaded items prices
		this.eventBus.emit("update_selected_price_list", applied);

		// Update prices for items already in cart
		if (this.items && this.items.length > 0) {
			this.update_cart_item_prices();
		} else {
			this.apply_cached_price_list(applied);
		}

		// If multi-currency is enabled, sync currency with the price list currency
		if (this.pos_profile.posa_allow_multi_currency && applied) {
			frappe.call({
				method: "posawesome.posawesome.api.invoices.get_price_list_currency",
				args: { price_list: applied },
				callback: (r) => {
					if (r.message) {
						// Store price list currency for later use
						this.price_list_currency = r.message;
						// Sync invoice currency with price list currency
						this.update_currency(r.message);
					}
				},
			});
		}
	},

	// Watch for customer price list changes and apply cached rates
	customer_price_list(newVal) {
		// Clear cached price list items to avoid mixing rates
		clearPriceListCache();

		// If customer has a price list, apply it and update cart items
		if (newVal) {
			// Note: update_customer_price_list event is already emitted by fetch_customer_details()
			// So we don't emit it here to avoid double-triggering

			// Update prices for items already in cart
			if (this.items && this.items.length > 0) {
				this.update_cart_item_prices();
			} else {
				this.apply_cached_price_list(newVal);
			}

			// If multi-currency is enabled, sync currency with the price list currency
			if (this.pos_profile.posa_allow_multi_currency) {
				frappe.call({
					method: "posawesome.posawesome.api.invoices.get_price_list_currency",
					args: { price_list: newVal },
					callback: (r) => {
						if (r.message) {
							// Store price list currency for later use
							this.price_list_currency = r.message;
							// Sync invoice currency with price list currency
							this.update_currency(r.message);
						}
					},
				});
			}
		}
	},

	async update_cart_item_prices() {
		if (!this.items || this.items.length === 0) {
			return;
		}

		const vm = this;
		const price_list = this.get_price_list();

		// First try to apply cached prices for immediate visual update
		this.apply_cached_price_list(price_list);

		// Then fetch fresh prices from server for all cart items
		try {
			const itemCodes = [...new Set(this.items.map((item) => item.item_code))];
			const response = await frappe.call({
				method: "posawesome.posawesome.api.items.get_items_details",
				args: {
					pos_profile: JSON.stringify(this.pos_profile),
					items_data: JSON.stringify(
						this.items.map((item) => ({
							item_code: item.item_code,
							posa_row_id: item.posa_row_id,
							uom: item.uom,
							qty: item.qty,
						})),
					),
					price_list: price_list,
				},
			});

			if (response && response.message) {
				this.items.forEach((item) => {
					const updated = response.message.find(
						(el) => el.item_code === item.item_code && el.posa_row_id === item.posa_row_id,
					);

					if (updated) {
						// Update price list rate and rates if not manually set
						if (updated.price_list_rate !== undefined) {
							item.price_list_rate = updated.price_list_rate;
							// Only update rate if it wasn't manually changed by user
							if (!item._manual_rate_set) {
								item.rate = updated.price_list_rate;
								item.base_rate = updated.price_list_rate;
							}
						}

						// Update stock quantities and batch/serial data
						if (updated.actual_qty !== undefined) item.actual_qty = updated.actual_qty;
						if (updated.serial_no_data) item.serial_no_data = updated.serial_no_data;
						if (updated.batch_no_data) item.batch_no_data = updated.batch_no_data;
						if (updated.item_uoms) item.item_uoms = updated.item_uoms;

						// Recalculate item price
						this.calc_item_price(item);
					}
				});

				this.$forceUpdate();
			}
		} catch (error) {
			console.error("Error updating cart item prices:", error);
			// If server call fails, at least we have the cached prices applied
		}
	},

	// Reactively update item prices when currency changes
	selected_currency() {
		clearPriceListCache();
		if (this.items && this.items.length) {
			this.update_cart_item_prices();
		}
	},

	// Reactively update item prices when exchange rate changes
	exchange_rate() {
		if (this.items && this.items.length) {
			this.update_cart_item_prices();
		}
	},
};
