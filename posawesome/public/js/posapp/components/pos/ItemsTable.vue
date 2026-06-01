<template>
	<div class="my-0 py-0 overflow-y-auto items-table-container" :style="{ height: 'calc(100% - 80px)', maxHeight: 'calc(100% - 80px)' }" @dragover="onDragOverFromSelector($event)" @drop="onDropFromSelector($event)" @dragenter="onDragEnterFromSelector" @dragleave="onDragLeaveFromSelector">
		<v-data-table-virtual :headers="headers" :items="items" :theme="$theme.current" :expanded="expanded" show-expand item-value="posa_row_id" class="modern-items-table elevation-2" :items-per-page="itemsPerPage" density="compact" hide-default-footer :single-expand="true" :header-props="headerProps" :row-props="getRowProps" @update:expanded="$emit('update:expanded', $event)" :search="itemSearch">
			<!-- Serial number column -->
			<template v-slot:item.si_no="{ item }">
				<span>{{ getRowSerial(item) }}</span>
			</template>

			<!-- Item name column (explicit expand trigger) -->
			<template v-slot:item.item_name="{ item }">
				<div class="item-name-cell" @click.stop="toggleRowExpand(item)">
					<div class="item-name-text">{{ item.item_name }}</div>
					<div
						v-if="item.has_batch_no && (item.batch_no || item.batch_no_expiry_date)"
						class="item-meta"
					>
						<span v-if="item.batch_no_expiry_date" class="item-meta__entry">
							{{ __("Expiry") }}: {{ item.batch_no_expiry_date }}
						</span>
					</div>
				</div>
			</template>

			<!-- Quantity column -->
			<template v-slot:item.qty="{ item }">
				<div class="qty-cell" :data-row-id="item.posa_row_id">
					<v-text-field
						density="compact"
						variant="underlined"
						color="primary"
						hide-details
						class="row-edit-field"
						:model-value="formatFloat(item.qty, hide_qty_decimals ? 0 : undefined)"
						:disabled="!canEditQty(item)"
						@change="onQtyChange(item, $event)"
					></v-text-field>
				</div>
			</template>

			<!-- UOM column -->
			<template v-slot:item.uom="{ item }">
				<select
					class="row-edit-native-select"
					:value="item.uom"
					:disabled="!canEditUom(item)"
					@change="onUomChange(item, $event.target.value)"
				>
					<option v-for="u in (item.item_uoms || [])" :key="u.uom" :value="u.uom">
						{{ u.uom }}
					</option>
				</select>
			</template>

			<!-- Rate column -->
			<template v-slot:item.rate="{ item }">
				<v-text-field
					density="compact"
					variant="underlined"
					color="primary"
					hide-details
					class="row-edit-field"
					:model-value="formatCurrency(item.rate)"
					:prefix="safeCurrencySymbol(displayCurrency)"
					:disabled="!canEditRate(item)"
					@change="onRateChange(item, $event)"
				></v-text-field>
			</template>

			<!-- Amount column -->
			<template v-slot:item.amount="{ item }">
				<v-text-field
					density="compact"
					variant="underlined"
					color="primary"
					hide-details
					class="amount-edit-field"
					:model-value="formatCurrency(item.qty * item.rate)"
					:prefix="safeCurrencySymbol(displayCurrency)"
					:disabled="!canEditAmount(item)"
					@change="onAmountChange(item, $event)"
				></v-text-field>
			</template>

			<!-- Discount percentage column -->
			<template v-slot:item.discount_value="{ item }">
				<v-text-field
					density="compact"
					variant="underlined"
					color="primary"
					hide-details
					class="row-edit-field"
					:model-value="formatFloat(item.discount_percentage || 0)"
					suffix="%"
					:disabled="!canEditItemDiscount(item)"
					@change="onDiscountPercentageChange(item, $event)"
				></v-text-field>
			</template>

			<!-- Discount amount column -->
			<template v-slot:item.discount_amount="{ item }">
				<v-text-field
					density="compact"
					variant="underlined"
					color="primary"
					hide-details
					class="row-edit-field"
					:model-value="formatCurrency(item.discount_amount || 0)"
					:prefix="safeCurrencySymbol(displayCurrency)"
					:disabled="!canEditItemDiscount(item)"
					@change="onDiscountAmountChange(item, $event)"
				></v-text-field>
			</template>

			<!-- Price list rate column -->
			<template v-slot:item.price_list_rate="{ item }">
				<div class="currency-display">
					<span v-if="safeCurrencySymbol(displayCurrency)" class="currency-symbol">{{
						safeCurrencySymbol(displayCurrency)
					}}</span>
					<span class="amount-value">{{ formatCurrency(item.price_list_rate) }}</span>
				</div>
			</template>

			<!-- Offer checkbox column -->
			<template v-slot:item.posa_is_offer="{ item }">
				<v-checkbox-btn v-model="item.posa_is_offer" class="center" @change="toggleOffer(item)"></v-checkbox-btn>
			</template>

			<!-- Expanded row content using Vuetify's built-in system -->
			<template v-slot:expanded-row="{ item }">
				<td :colspan="headers.length" class="ma-0 pa-0">
					<div class="expanded-content">
						<!-- Action buttons -->
						<div class="action-panel">
							<div class="action-button-group">
								<v-btn :disabled="!!item.posa_is_replace" icon="mdi-trash-can-outline" size="large" color="error" variant="tonal" class="item-action-btn delete-btn" @click.stop="removeItem(item)">
									<v-icon size="large">mdi-trash-can-outline</v-icon>
									<span class="action-label">{{ __("Remove") }}</span>
								</v-btn>
								<v-btn :disabled="!!item.posa_is_replace" size="large" color="blue" variant="tonal" class="item-action-btn plus-btn" @click.stop="openItemHistory(item)">
									<v-icon size="large">mdi-history</v-icon>
									<span class="action-label">{{ __("History") }}</span>
								</v-btn>
								<v-btn :disabled="!!item.posa_is_replace" size="large" color="indigo" variant="tonal" class="item-action-btn plus-btn" @click.stop="openItemWarehouseStock(item)">
									<v-icon size="large">mdi-warehouse</v-icon>
									<span class="action-label">{{ __("Stock") }}</span>
								</v-btn>
							</div>
						</div>

						<!-- Item details form: show only non-row fields -->
						<div class="item-details-form">
							<div class="form-row" v-if="item.has_batch_no">
								<div class="form-field">
										<v-select
										density="compact"
										variant="outlined"
										color="primary"
										:label="frappe._('Batch No')"
										:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
										class="dark-field"
										:items="getBatchOptions(item)"
										item-title="title"
										item-value="value"
										:model-value="item.batch_no || ''"
										:disabled="!hasBatchOptions(item)"
										@update:model-value="onBatchSelection(item, $event)"
									></v-select>
								</div>
								<div class="form-field">
									<v-text-field
										density="compact"
										variant="outlined"
										color="primary"
										:label="frappe._('Batch No Expiry Date')"
										:bg-color="isDarkTheme ? '#1E1E1E' : 'white'"
										class="dark-field"
										hide-details
										:model-value="item.batch_no_expiry_date || ''"
										disabled
									></v-text-field>
								</div>
							</div>
							<div class="form-row">
								<div class="form-field" v-if="isFieldVisible('exp_item_code')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Item Code')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details v-model="item.item_code" disabled prepend-inner-icon="mdi-barcode"></v-text-field>
								</div>
								<div class="form-field" v-if="isFieldVisible('exp_price_list_rate')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Price list Rate')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details :model-value="formatCurrency(item.price_list_rate)" :disabled="!pos_profile.posa_allow_price_list_rate_change" :prefix="safeCurrencySymbol(pos_profile.currency)" @change="changePriceListRate(item)"></v-text-field>
								</div>
								<div class="form-field" v-if="isFieldVisible('exp_available_qty')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Available QTY')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details :model-value="formatFloat(item.actual_qty)" disabled></v-text-field>
								</div>
								<div class="form-field" v-if="isFieldVisible('exp_group')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Group')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details v-model="item.item_group" disabled></v-text-field>
								</div>
							</div>
							<div class="form-row">
								<div class="form-field" v-if="isFieldVisible('exp_stock_qty')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Stock QTY')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details :model-value="formatFloat(item.stock_qty)" disabled></v-text-field>
								</div>
								<div class="form-field" v-if="isFieldVisible('exp_stock_uom')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Stock UOM')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details v-model="item.stock_uom" disabled></v-text-field>
								</div>
								<div class="form-field" v-if="isFieldVisible('exp_warehouse')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Warehouse')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details v-model="item.warehouse" disabled prepend-inner-icon="mdi-warehouse"></v-text-field>
								</div>
								<div class="form-field" v-if="isFieldVisible('exp_price_list_rate_bottom')">
									<v-text-field density="compact" variant="outlined" color="primary" :label="frappe._('Price List Rate Change')" :bg-color="isDarkTheme ? '#1E1E1E' : 'white'" class="dark-field" hide-details :model-value="formatCurrency(item.price_list_rate || 0)" :disabled="!pos_profile.posa_allow_price_list_rate_change" prepend-inner-icon="mdi-format-list-numbered" @change="changePriceListRate(item)"></v-text-field>
									<v-btn v-if="pos_profile.posa_allow_price_list_rate_change" size="x-small" class="ml-1" @click.stop="changePriceListRate(item)">{{ __("Change") }}</v-btn>
								</div>
							</div>
						</div>
					</div>
				</td>
			</template>

			<template v-slot:item.data-table-expand="{ item, internalItem, isExpanded, toggleExpand }">
				<v-btn
					icon
					variant="text"
					density="compact"
					@click.stop="toggleExpand(internalItem)"
				>
					<v-icon>{{ isExpanded(internalItem) ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
				</v-btn>
			</template>
		</v-data-table-virtual>
		<v-dialog v-model="showItemHistoryDialog" width="900">
			<v-card>

				<v-card-title class="text-h6">
					Item History
				</v-card-title>

				<v-card-text>
					<div>
						<b>Customer Name:</b> {{ customer }}
					</div>

					<div>
						<b>Item Name:</b> {{ selectedItem?.item_name }}
					</div>

					<div v-if="itemHistory.length">

						<b>Last Purchase History:</b>

						<v-table density="compact">
							<thead>
								<tr>
									<th>Sr No</th>
									<th>Branch</th>
									<th>Date</th>
									<th>Qty</th>
									<th>Unit Price</th>
									<th>Total Amount</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="(row, index) in itemHistory" :key="index">
									<td>{{ index + 1 }}</td>
									<td>{{ row.cost_center }}</td>
									<td>{{ row.posting_date }}</td>
									<td>{{ row.qty }}</td>
									<td>{{ row.rate }}</td>
									<td>{{ row.amount }}</td>
								</tr>
							</tbody>
						</v-table>
					</div>
					<div v-else class="mt-3 text-medium-emphasis">
						No purchase history found for this customer and item.
					</div>
				</v-card-text>

				<v-card-actions>
					<v-spacer></v-spacer>

					<v-btn color="red" @click="showItemHistoryDialog = false">
						Close
					</v-btn>
				</v-card-actions>

			</v-card>
		</v-dialog>
		<v-dialog v-model="showWarehouseStockDialog" width="700">
			<v-card>

				<v-card-title class="text-h6">
					Warehouse Stock
				</v-card-title>

				<v-card-text>
					<div>
						<b>Item Name:</b> {{ selectedStockItem?.item_name }}
					</div>

					<div class="mt-2">
						<b>Item Code:</b> {{ selectedStockItem?.item_code }}
					</div>

					<div v-if="warehouseStockLoading" class="mt-3 text-medium-emphasis">
						Loading warehouse stock...
					</div>

					<div v-else-if="warehouseStock.length" class="mt-3">
						<v-table density="compact">
							<thead>
								<tr>
									<th>Sr No</th>
									<th>Warehouse</th>
									<th>Available Qty</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="(row, index) in warehouseStock" :key="`${row.warehouse}-${index}`">
									<td>{{ index + 1 }}</td>
									<td>{{ row.warehouse }}</td>
									<td>{{ formatFloat(row.actual_qty) }}</td>
								</tr>
							</tbody>
						</v-table>
					</div>
					<div v-else class="mt-3 text-medium-emphasis">
						No warehouses found to display stock.
					</div>
				</v-card-text>

				<v-card-actions>
					<v-spacer></v-spacer>

					<v-btn color="red" @click="showWarehouseStockDialog = false">
						Close
					</v-btn>
				</v-card-actions>

			</v-card>
		</v-dialog>
	</div>
</template>

<script>
export default {
	name: "ItemsTable",
	props: {
		headers: Array,
		items: Array,
		expanded: Array,
		itemsPerPage: Number,
		itemSearch: String,
		customer: String,
		pos_profile: Object,
		invoice_doc: Object,
		invoiceType: String,
		displayCurrency: String,
		formatFloat: Function,
		formatCurrency: Function,
		currencySymbol: Function,
		selectedColumns: {
			type: Array,
			default: () => [],
		},
		isNumber: Function,
		setFormatedQty: Function,
		calcStockQty: Function,
		setFormatedCurrency: Function,
		calcPrices: Function,
		calcUom: Function,
		setSerialNo: Function,
		setBatchQty: Function,
		validateDueDate: Function,
		removeItem: Function,
		subtractOne: Function,
		addOne: Function,
		isReturnInvoice: Boolean,
		toggleOffer: Function,
		changePriceListRate: Function,
	},
	data() {
		return {
			draggedItem: null,
			draggedIndex: null,
			dragOverIndex: null,
			isDragging: false,
			showItemHistoryDialog: false,
			showWarehouseStockDialog: false,
			selectedItem: null,
			selectedStockItem: null,
			itemHistory: [],
			warehouseStock: [],
			warehouseStockLoading: false,
		};
	},
	mounted() {
		this.sanitizeGridTabStops();
		this.eventBus.on("focus_item_qty", this.focusItemQtyInput);
	},
	updated() {
		this.sanitizeGridTabStops();
	},
	beforeUnmount() {
		this.eventBus.off("focus_item_qty", this.focusItemQtyInput);
	},
	computed: {
		headerProps() {
			return this.isDarkTheme ? { style: "background-color:#121212;color:#fff" } : {};
		},
		isDarkTheme() {
			return this.$theme.current === "dark";
		},
		hide_qty_decimals() {
			try {
				const saved = localStorage.getItem("posawesome_item_selector_settings");
				if (saved) {
					const opts = JSON.parse(saved);
					return !!opts.hide_qty_decimals;
				}
			} catch (e) {
				console.error("Failed to load item selector settings:", e);
			}
			return false;
		},
	},
	methods: {
		isProfileFlagEnabled(fieldname, defaultValue = false) {
			if (!this.pos_profile || typeof this.pos_profile !== "object") {
				return defaultValue;
			}

			const value = this.pos_profile[fieldname];
			if (value === undefined || value === null || value === "") {
				return defaultValue;
			}

			if (typeof value === "string") {
				if (value === "1") {
					return true;
				}
				if (value === "0") {
					return false;
				}
			}

			return !!value;
		},
		canEditQty(item) {
			return this.isProfileFlagEnabled("posa_allow_user_to_edit_qty", true) && !item?.posa_is_replace;
		},
		canEditUom(item) {
			if (this.isReturnInvoice && this.invoice_doc?.return_against) {
				return false;
			}

			return this.isProfileFlagEnabled("posa_allow_user_to_edit_uom", true) && !item?.posa_is_replace;
		},
		canEditRate(item) {
			return (
				this.isProfileFlagEnabled("posa_allow_user_to_edit_rate", true) &&
				!item?.posa_is_replace &&
				!item?.posa_offer_applied
			);
		},
		canEditAmount(item) {
			// Amount edit follows the same permission as rate edit.
			return this.canEditRate(item);
		},
		canEditItemDiscount(item) {
			return (
				this.isProfileFlagEnabled("posa_allow_user_to_edit_item_discount", true) &&
				!item?.posa_is_replace &&
				!item?.posa_offer_applied
			);
		},
		focusItemQtyInput(payload) {
			const rowId = typeof payload === "string" ? payload : payload?.row_id;
			if (!rowId) {
				return;
			}

			this.$nextTick(() => {
				const selector = `.qty-cell[data-row-id="${rowId}"] input`;
				const input = this.$el?.querySelector(selector);
				if (!input || input.disabled) {
					return;
				}

				input.focus();
				if (typeof input.select === "function") {
					input.select();
				}
			});
		},
		safeCurrencySymbol(currency) {
			const symbol = this.currencySymbol ? this.currencySymbol(currency) : "";
			if (typeof symbol !== "string") {
				return "";
			}
			const normalized = symbol.trim();
			if (/^[A-Z]{3}$/.test(normalized)) {
				return "";
			}
			return normalized || "";
		},
		isFieldVisible(key) {
			if (!Array.isArray(this.selectedColumns) || this.selectedColumns.length === 0) {
				return true;
			}
			return this.selectedColumns.includes(key);
		},
		getRowSerial(item) {
			if (!item) {
				return "";
			}

			const rows = Array.isArray(this.items) ? this.items : [];
			const index = rows.findIndex((row) => row.posa_row_id === item.posa_row_id);
			if (index >= 0) {
				return index + 1;
			}

			const fallbackIndex = rows.indexOf(item);
			return fallbackIndex >= 0 ? fallbackIndex + 1 : "";
		},
		sanitizeGridTabStops() {
			this.$nextTick(() => {
				const tableRoot = this.$el?.querySelector(".modern-items-table");
				if (!tableRoot) {
					return;
				}

				const nonInputFocusableSelectors = [
					"th",
					"td",
					"[role='columnheader']",
					"[role='gridcell']",
					"[role='rowheader']",
					"[role='combobox']",
					".v-data-table-header__content button",
					".v-data-table__th button",
				].join(",");

				tableRoot.querySelectorAll(nonInputFocusableSelectors).forEach((el) => {
					el.setAttribute("tabindex", "-1");
				});

				const rowInputSelectors = [
					".row-edit-field input",
					".row-edit-field textarea",
					".row-edit-native-select",
				].join(",");

				tableRoot.querySelectorAll(rowInputSelectors).forEach((el) => {
					if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
						el.setAttribute("tabindex", "-1");
						return;
					}
					el.setAttribute("tabindex", "0");
				});
			});
		},
		getRowProps() {
			return { tabindex: -1 };
		},
		toggleRowExpand(item) {
			if (!item || !item.posa_row_id) {
				return;
			}

			const isExpanded = Array.isArray(this.expanded) && this.expanded.includes(item.posa_row_id);
			if (isExpanded) {
				this.$emit("update:expanded", []);
				return;
			}

			this.$emit("update:expanded", [item.posa_row_id]);
		},
		getInputValue(event) {
			if (event && event.target) {
				return event.target.value;
			}
			return event;
		},
		hasBatchOptions(item) {
			return Array.isArray(item?.batch_no_data) && item.batch_no_data.length > 0;
		},
		getBatchOptions(item) {
			if (!this.hasBatchOptions(item)) {
				return [];
			}
			return item.batch_no_data.map((batch) => {
				const parts = [batch.batch_no];
				if (batch.batch_qty !== undefined && batch.batch_qty !== null) {
					const qty = typeof this.formatFloat === "function" ? this.formatFloat(batch.batch_qty) : batch.batch_qty;
					parts.push(`${__("QTY")}: ${qty}`);
				}
				if (batch.expiry_date) {
					parts.push(`${__("Expiry")}: ${batch.expiry_date}`);
				}
				return {
					title: parts.join(" | "),
					value: batch.batch_no,
				};
			});
		},
		onBatchSelection(item, value) {
			if (!item) {
				return;
			}
			this.setBatchQty(item, value);
		},
		onQtyChange(item, event) {
			if (!item) {
				return;
			}

			const value = this.getInputValue(event);
			this.setFormatedQty(item, "qty", null, false, value);
			this.calcStockQty(item, item.qty);
			this.$forceUpdate();
		},
		onUomChange(item, value) {
			if (!item) {
				return;
			}

			this.calcUom(item, value);
		},
		onRateChange(item, event) {
			if (!item) {
				return;
			}

			const value = this.getInputValue(event);
			this.setFormatedCurrency(item, "rate", null, false, event);
			this.calcPrices(item, value, { target: { id: "rate", value } });
		},
		onDiscountPercentageChange(item, event) {
			if (!item) {
				return;
			}

			const value = this.getInputValue(event);
			this.setFormatedCurrency(item, "discount_percentage", null, false, event);
			this.calcPrices(item, value, { target: { id: "discount_percentage", value } });
		},
		onDiscountAmountChange(item, event) {
			if (!item) {
				return;
			}

			const value = this.getInputValue(event);
			this.setFormatedCurrency(item, "discount_amount", null, false, event);
			this.calcPrices(item, value, { target: { id: "discount_amount", value } });
		},
		onAmountChange(item, event) {
			if (!item) {
				return;
			}

			this.setFormatedCurrency(item, "amount", null, true, event);
			const qty = parseFloat(String(item.qty ?? "0").replace(/,/g, "")) || 0;

			if (!qty) {
				this.eventBus.emit("show_message", {
					title: __("Quantity must be greater than 0 to edit amount"),
					color: "error",
				});
				return;
			}

			const amount = parseFloat(String(item.amount ?? "0").replace(/,/g, "")) || 0;
			item.rate = amount / qty;

			this.calcPrices(item, item.rate, { target: { id: "rate", value: item.rate } });
		},
		openItemHistory(item) {

			console.log("Item clicked:", item)
			console.log("Invoice Doc:", this.invoice_doc)

			// store selected item
			this.selectedItem = item

			// clear previous history
			this.itemHistory = []

			// open dialog
			this.showItemHistoryDialog = true

			// call history function (we will create next)
			this.loadItemHistory()

			console.log("Dialog status:", this.showItemHistoryDialog)
		},
		loadItemHistory() {

			console.log("Loading history for item:", this.selectedItem)

			frappe.call({
				method: "posawesome.posawesome.api.api.item_history",
				args: {
					item_code: this.selectedItem.item_code,
					customer: this.customer
				},
				callback: (r) => {

					console.log("History Response:", r)

					if (r.message) {
						const historyRows = Array.isArray(r.message) ? [...r.message] : [];
						const parseRowTime = (row) => {
							if (!row) {
								return 0;
							}

							const modifiedTs = row.modified ? Date.parse(row.modified) : NaN;
							if (!Number.isNaN(modifiedTs)) {
								return modifiedTs;
							}

							const postingDateTs = row.posting_date ? Date.parse(row.posting_date) : NaN;
							if (!Number.isNaN(postingDateTs)) {
								return postingDateTs;
							}

							return 0;
						};

						historyRows.sort((a, b) => parseRowTime(b) - parseRowTime(a));
						this.itemHistory = historyRows;
					}

				},
				error: (err) => {
					console.error("History API Error:", err)
				}
			})

		},
		openItemWarehouseStock(item) {
			this.selectedStockItem = item;
			this.warehouseStock = [];
			this.showWarehouseStockDialog = true;
			this.loadItemWarehouseStock();
		},
		loadItemWarehouseStock() {
			if (!this.selectedStockItem?.item_code) {
				return;
			}

			this.warehouseStockLoading = true;

			frappe.call({
				method: "posawesome.posawesome.api.api.item_stock_by_warehouse",
				args: {
					item_code: this.selectedStockItem.item_code,
					company: this.pos_profile?.company,
				},
				callback: (r) => {
					this.warehouseStock = Array.isArray(r.message) ? r.message : [];
					this.warehouseStockLoading = false;
				},
				error: (err) => {
					console.error("Warehouse stock API Error:", err);
					this.warehouseStock = [];
					this.warehouseStockLoading = false;
				},
			});
		},
		onDragOverFromSelector(event) {
			// Check if drag data is from item selector
			const dragData = event.dataTransfer.types.includes("application/json");
			if (dragData) {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}
		},

		onDragEnterFromSelector(event) {
			this.$emit("show-drop-feedback", true);
		},

		onDragLeaveFromSelector(event) {
			// Only hide feedback if leaving the entire table area
			if (!event.currentTarget.contains(event.relatedTarget)) {
				this.$emit("show-drop-feedback", false);
			}
		},

		onDropFromSelector(event) {
			event.preventDefault();

			try {
				const dragData = JSON.parse(event.dataTransfer.getData("application/json"));

				if (dragData.type === "item-from-selector") {
					this.$emit("add-item-from-drag", dragData.item);
					this.$emit("item-dropped", false);
				}
			} catch (error) {
				console.error("Error parsing drag data:", error);
			}
		},
	},
};
</script>

<style scoped>
/* Modern table styling with enhanced visual hierarchy */
.modern-items-table {
	border-radius: var(--border-radius-lg);
	overflow: hidden;
	box-shadow: var(--shadow-md);
	border: 1px solid rgba(0, 0, 0, 0.09);
	height: 100%;
	display: flex;
	flex-direction: column;
	transition: all 0.3s ease;
}

/* Ensure items table can scroll when many rows exist */
.items-table-container {
	overflow-y: auto;
}

/* Table wrapper styling */
.modern-items-table :deep(.v-data-table__wrapper),
.modern-items-table :deep(.v-table__wrapper) {
	border-radius: var(--border-radius-sm);
	height: 100%;
	overflow-y: auto;
	scrollbar-width: thin;
}

/* Table header styling */
.modern-items-table :deep(th) {
	font-weight: 600;
	font-size: 0.9rem;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	padding: 12px 16px;
	transition: background-color var(--transition-normal);
	border-bottom: 2px solid var(--table-header-border);
	background-color: var(--table-header-bg);
	color: var(--table-header-text);
	position: sticky;
	top: 0;
	z-index: 1;
}

/* Table row styling */
.modern-items-table :deep(tr) {
	transition: all 0.2s ease;
	border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.modern-items-table :deep(tr:hover) {
	background-color: var(--table-row-hover);
	transform: translateY(-1px);
	box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
}

/* Table cell styling */
.modern-items-table :deep(td) {
	padding: 12px 16px;
	vertical-align: middle;
}

/* Expanded content styling */
.expanded-content {
	padding: var(--dynamic-md);
	background-color: var(--surface-secondary);
	border-radius: 0 0 var(--border-radius-md) var(--border-radius-md);
	box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.05);
	animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
	from {
		opacity: 0;
		transform: translateY(-10px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

/* Action panel styling */
.action-panel {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 12px;
	margin-bottom: 16px;
	background-color: rgba(0, 0, 0, 0.02);
	border-radius: var(--border-radius-md);
	border: 1px solid rgba(0, 0, 0, 0.05);
}

:deep(.dark-theme) .action-panel,
:deep(.v-theme--dark) .action-panel {
	background-color: rgba(255, 255, 255, 0.05);
	border: 1px solid rgba(255, 255, 255, 0.1);
}

.action-button-group {
	display: flex;
	gap: 8px;
}

/* Item action buttons styling */
.item-action-btn {
	min-width: 44px !important;
	height: 44px !important;
	border-radius: 12px !important;
	transition: all 0.3s ease;
	box-shadow: 0 3px 8px rgba(0, 0, 0, 0.1) !important;
	position: relative;
	overflow: hidden;
	display: flex;
	align-items: center;
	padding: 0 16px !important;
}

.item-action-btn .action-label {
	margin-left: 8px;
	font-weight: 500;
	display: none;
}

@media (min-width: 600px) {
	.item-action-btn .action-label {
		display: inline-block;
	}

	.item-action-btn {
		min-width: 120px !important;
	}
}

.item-action-btn:hover {
	transform: translateY(-2px);
	box-shadow: 0 5px 12px rgba(0, 0, 0, 0.15) !important;
}

.item-action-btn .v-icon {
	font-size: 22px !important;
	position: relative;
	z-index: 2;
}

/* Light theme button styles with enhanced gradients */
.item-action-btn.delete-btn {
	background: linear-gradient(145deg, #ffebee, #ffcdd2) !important;
}

.item-action-btn.delete-btn:hover {
	background: linear-gradient(145deg, #ffcdd2, #ef9a9a) !important;
}

.item-action-btn.minus-btn {
	background: linear-gradient(145deg, #fff8e1, #ffecb3) !important;
}

.item-action-btn.minus-btn:hover {
	background: linear-gradient(145deg, #ffecb3, #ffe082) !important;
}

.item-action-btn.plus-btn {
	background: linear-gradient(145deg, #e8f5e9, #c8e6c9) !important;
}

.item-action-btn.plus-btn:hover {
	background: linear-gradient(145deg, #c8e6c9, #a5d6a7) !important;
}

/* Dark theme button styles */
:deep(.dark-theme) .item-action-btn.delete-btn,
:deep(.v-theme--dark) .item-action-btn.delete-btn {
	background: linear-gradient(145deg, #4a1515, #3a1010) !important;
	color: #ff8a80 !important;
}

:deep(.dark-theme) .item-action-btn.delete-btn:hover,
:deep(.v-theme--dark) .item-action-btn.delete-btn:hover {
	background: linear-gradient(145deg, #5a1a1a, #4a1515) !important;
}

:deep(.dark-theme) .item-action-btn.minus-btn,
:deep(.v-theme--dark) .item-action-btn.minus-btn {
	background: linear-gradient(145deg, #4a3c10, #3a2e0c) !important;
	color: #ffe082 !important;
}

:deep(.dark-theme) .item-action-btn.minus-btn:hover,
:deep(.v-theme--dark) .item-action-btn.minus-btn:hover {
	background: linear-gradient(145deg, #5a4a14, #4a3c10) !important;
}

:deep(.dark-theme) .item-action-btn.plus-btn,
:deep(.v-theme--dark) .item-action-btn.plus-btn {
	background: linear-gradient(145deg, #1b4620, #133419) !important;
	color: #a5d6a7 !important;
}

:deep(.dark-theme) .item-action-btn.plus-btn:hover,
:deep(.v-theme--dark) .item-action-btn.plus-btn:hover {
	background: linear-gradient(145deg, #235828, #1b4620) !important;
}

:deep(.dark-theme) .item-action-btn .v-icon,
:deep(.v-theme--dark) .item-action-btn .v-icon {
	opacity: 0.9;
}

/* Form layout styling */
.item-details-form {
	margin-top: 16px;
}

.form-row {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 12px;
}

.form-field {
	flex: 1;
	min-width: 200px;
}

.form-field.full-width {
	flex-basis: 100%;
}

.form-section {
	margin-top: 16px;
	padding-top: 16px;
	border-top: 1px dashed rgba(0, 0, 0, 0.1);
}

:deep(.dark-theme) .form-section,
:deep(.v-theme--dark) .form-section {
	border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

/* Currency and amount display */
.currency-display {
	display: flex;
	align-items: center;
	justify-content: flex-start;
}

.currency-symbol {
	opacity: 0.7;
	margin-right: 2px;
	font-size: 0.85em;
}

.amount-value {
	font-weight: 500;
	text-align: left;
}

.row-edit-field {
	min-width: 90px;
}

.row-edit-native-select {
	width: 100%;
	min-width: 90px;
	border: none;
	border-bottom: 1px solid rgba(0, 0, 0, 0.35);
	background: transparent;
	padding: 6px 2px;
	outline: none;
}

.row-edit-native-select:focus {
	border-bottom-color: rgb(var(--v-theme-primary));
}

.item-name-cell {
	cursor: pointer;
	font-weight: 500;
}

.item-name-text {
	line-height: 1.2;
}

.item-meta {
	margin-top: 4px;
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	font-size: 0.75rem;
	color: rgba(0, 0, 0, 0.6);
}

.item-meta__entry {
	white-space: nowrap;
}

:deep(.dark-theme) .item-meta,
:deep(.v-theme--dark) .item-meta {
	color: rgba(255, 255, 255, 0.7);
}

/* Drag and drop styles */
.draggable-row {
	transition: all 0.2s ease;
	cursor: move;
}

.draggable-row:hover {
	background-color: rgba(0, 0, 0, 0.02);
}

:deep(.dark-theme) .draggable-row:hover,
:deep(.v-theme--dark) .draggable-row:hover {
	background-color: rgba(255, 255, 255, 0.05);
}

.drag-handle-cell {
	width: 40px;
	text-align: center;
	padding: 8px 4px;
}

.drag-handle {
	cursor: grab;
	opacity: 0.6;
	transition: opacity 0.2s ease;
}

.drag-handle:hover {
	opacity: 1;
}

.drag-handle:active {
	cursor: grabbing;
}

.drag-source {
	opacity: 0.5;
	background-color: rgba(25, 118, 210, 0.1) !important;
}

.drag-over {
	background-color: rgba(25, 118, 210, 0.2) !important;
	border-top: 2px solid #1976d2;
	transform: translateY(-1px);
}

.drag-active .draggable-row:not(.drag-source):not(.drag-over) {
	opacity: 0.7;
}

/* Dark theme drag styles */
:deep(.dark-theme) .drag-source,
:deep(.v-theme--dark) .drag-source {
	background-color: rgba(144, 202, 249, 0.1) !important;
}

:deep(.dark-theme) .drag-over,
:deep(.v-theme--dark) .drag-over {
	background-color: rgba(144, 202, 249, 0.2) !important;
	border-top: 2px solid #90caf9;
}

/* Expanded row styling */
.expanded-row {
	background-color: var(--surface-secondary);
}
</style>
