<template>
	<div :style="responsiveStyles">
		<v-card
			:class="[
				'selection mx-auto my-0 py-0 mt-3 dynamic-card resizable',
				isDarkTheme ? '' : 'bg-grey-lighten-5',
			]"
			:style="{
				height: responsiveStyles['--container-height'],
				maxHeight: responsiveStyles['--container-height'],
				backgroundColor: isDarkTheme ? '#121212' : '',
				resize: 'vertical',
				overflow: 'auto',
			}"
		>
			<v-progress-linear
				:active="loading && !items.length && !sync_in_progress"
				:indeterminate="loading && !items.length && !sync_in_progress"
				absolute
				location="top"
				color="info"
				aria-label="Loading item search results"
			></v-progress-linear>
			<!-- Add dynamic-padding wrapper like Invoice component -->
			<div class="dynamic-padding">
				<v-row class="items">
					<v-col class="pb-0">
						<v-text-field
							density="compact"
							clearable
							autofocus
							variant="solo"
							color="primary"
							autocomplete="off"
							autocorrect="off"
							autocapitalize="off"
							spellcheck="false"
							name="posa_item_search_no_autofill"
							:label="frappe._('Search Items')"
							hint="Search by item code, serial number, batch no or barcode"
							hide-details
							v-model="search_input"
							@keydown.esc.stop.prevent="esc_event"
							@keydown.down.stop.prevent="handleSearchArrowDown"
							@keydown.up.stop.prevent="handleSearchArrowUp"
							@keydown.enter.prevent="handleSearchEnter"
							@click:clear="clearSearch"
							prepend-inner-icon="mdi-magnify"
							@focus="handleItemSearchFocus"
							ref="debounce_search"
						>
							<!-- Add camera scan button if enabled -->
							<template v-slot:append-inner v-if="pos_profile.posa_enable_camera_scanning">
								<v-btn
									icon="mdi-camera"
									size="small"
									color="primary"
									variant="text"
									@click="startCameraScanning"
									:title="__('Scan with Camera')"
								>
								</v-btn>
							</template>
						</v-text-field>
						<div
							v-if="sync_in_progress"
							class="search-sync-progress mt-1 mb-1 px-1"
							data-test="item-search-sync-shell"
							aria-live="polite"
						>
							<v-progress-linear
								:model-value="clampedSyncProgress"
								height="3"
								rounded
								color="info"
								bg-color="rgba(15, 23, 42, 0.08)"
								data-test="item-search-sync-bar"
								:aria-label="__('Item sync progress')"
							></v-progress-linear>
							<div class="search-sync-progress__meta">
								<span class="search-sync-progress__label">
									{{ sync_status || __("Syncing items in background") }}
									<span v-if="normalizedSyncItemsCount > 0" class="search-sync-progress__count">
										{{ syncItemsCountLabel }}
									</span>
								</span>
								<span class="search-sync-progress__value">{{ clampedSyncProgress }}%</span>
							</div>
						</div>
					</v-col>
					<v-col cols="3" class="pb-0" v-if="pos_profile.posa_input_qty">
						<v-text-field
							density="compact"
							variant="solo"
							color="primary"
							:label="frappe._('QTY')"
							hide-details
							v-model="debounce_qty"
							type="text"
							@keydown.enter="enter_event"
							@keydown.esc.stop.prevent="esc_event"
							@focus="clearQty"
						></v-text-field>
					</v-col>
					<v-col cols="2" class="pb-0" v-if="pos_profile.posa_new_line">
						<v-checkbox
							v-model="new_line"
							color="accent"
							value="true"
							label="NLine"
							density="default"
							hide-details
						></v-checkbox>
					</v-col>
					<v-col cols="12" class="dynamic-margin-xs">
						<div class="settings-container">
							<v-btn
								density="compact"
								variant="text"
								color="primary"
								prepend-icon="mdi-cog-outline"
								@click="toggleItemSettings"
								class="settings-btn"
							>
								{{ __("Settings") }}
							</v-btn>
							<v-spacer></v-spacer>
							<v-btn
								density="compact"
								variant="text"
								color="primary"
								prepend-icon="mdi-refresh"
								@click="forceReloadItems"
								class="settings-btn"
							>
								{{ __("Reload Items") }}
							</v-btn>

							<v-dialog v-model="show_item_settings" max-width="400px">
								<v-card>
									<v-card-title class="text-h6 pa-4 d-flex align-center">
										<span>{{ __("Item Selector Settings") }}</span>
										<v-spacer></v-spacer>
										<v-btn
											icon="mdi-close"
											variant="text"
											density="compact"
											@click="show_item_settings = false"
										></v-btn>
									</v-card-title>
									<v-divider></v-divider>
									<v-card-text class="pa-4">
										<v-switch
											v-model="temp_hide_qty_decimals"
											:label="__('Hide quantity decimals')"
											hide-details
											density="compact"
											color="primary"
											class="mb-2"
										></v-switch>
										<v-switch
											v-model="temp_hide_zero_rate_items"
											:label="__('Hide zero rated items')"
											hide-details
											density="compact"
											color="primary"
										></v-switch>
									</v-card-text>
									<v-card-actions class="pa-4 pt-0">
										<v-btn color="error" variant="text" @click="cancelItemSettings">{{
											__("Cancel")
										}}</v-btn>
										<v-spacer></v-spacer>
										<v-btn color="primary" variant="tonal" @click="applyItemSettings">{{
											__("Apply")
										}}</v-btn>
									</v-card-actions>
								</v-card>
							</v-dialog>
						</div>
					</v-col>
					<v-col cols="12" class="pt-0 mt-0">
						<div
							fluid
							class="items-grid dynamic-scroll"
							ref="itemsContainer"
							v-if="items_view == 'card'"
							:style="{ maxHeight: 'calc(100% - 80px)' }"
						>
							<v-card
								v-for="(item, index) in filtered_items"
								:key="item.item_code"
								hover
								:class="[
									'dynamic-item-card',
									isItemSelected(index) ? 'dynamic-item-card--active' : '',
								]"
								:data-item-index="index"
								:draggable="true"
								@dragstart="onDragStart($event, item)"
								@dragend="onDragEnd"
								@click="add_item(item)"
							>
								<v-img
									:src="
										item.image ||
										'/assets/posawesome/js/posapp/components/pos/placeholder-image.png'
									"
									class="text-white align-end"
									gradient="to bottom, rgba(0,0,0,0), rgba(0,0,0,0.4)"
									height="100px"
								>
									<v-card-text class="text-caption px-1 pb-0 truncate">{{
										item.item_name
									}}</v-card-text>
								</v-img>
								<v-card-text class="text--primary pa-1">
									<div class="text-caption text-primary truncate d-flex align-center">
										<span>
											{{
												currencySymbol(item.original_currency || pos_profile.currency) ||
												""
											}}
											{{
												format_currency(
													item.base_price_list_rate || item.rate,
													item.original_currency || pos_profile.currency,
													ratePrecision(item.base_price_list_rate || item.rate),
												)
											}}
										</span>
										<ItemRateInfoMenu
											:rate-info="getItemRateInfo(item)"
											:currency-symbol="currencySymbol"
											:format-currency="format_currency"
											:rate-precision="ratePrecision"
										/>
									</div>
									<div
										v-if="
											pos_profile.posa_allow_multi_currency &&
											selected_currency !== pos_profile.currency
										"
										class="text-caption text-success truncate"
									>
										{{ currencySymbol(selected_currency) || "" }}
										{{
											format_currency(
												item.rate,
												selected_currency,
												ratePrecision(item.rate),
											)
										}}
									</div>
									<div class="text-caption golden--text truncate">
										{{ format_number(item.actual_qty, hide_qty_decimals ? 0 : 4) || 0 }}
										{{ item.stock_uom || "" }}
									</div>
								</v-card-text>
							</v-card>
						</div>
						<div v-else>
							<v-data-table-virtual
								:headers="headers"
								:items="filtered_items"
								class="sleek-data-table overflow-y-auto"
								:style="{ maxHeight: 'calc(100% - 80px)' }"
								item-key="item_code"
								:row-props="getListRowProps"
								@click:row="click_item_row"
							>
								<template v-slot:item.rate="{ item }">
									<div>
										<div class="text-primary d-flex align-center">
											<span>
												{{
													currencySymbol(item.original_currency || pos_profile.currency)
												}}
												{{
													format_currency(
														item.base_price_list_rate || item.rate,
														item.original_currency || pos_profile.currency,
														ratePrecision(item.base_price_list_rate || item.rate),
													)
												}}
											</span>
											<ItemRateInfoMenu
												:rate-info="getItemRateInfo(item)"
												:currency-symbol="currencySymbol"
												:format-currency="format_currency"
												:rate-precision="ratePrecision"
											/>
										</div>
										<div
											v-if="
												pos_profile.posa_allow_multi_currency &&
												selected_currency !== pos_profile.currency
											"
											class="text-success"
										>
											{{ currencySymbol(selected_currency) }}
											{{
												format_currency(
													item.rate,
													selected_currency,
													ratePrecision(item.rate),
												)
											}}
										</div>
									</div>
								</template>
								<template v-slot:item.actual_qty="{ item }">
									<span class="golden--text">{{
										format_number(item.actual_qty, hide_qty_decimals ? 0 : 4)
									}}</span>
								</template>
							</v-data-table-virtual>
						</div>
					</v-col>
				</v-row>
			</div>
		</v-card>
		<v-card class="cards mb-0 mt-3 dynamic-padding resizable" style="resize: vertical; overflow: auto">
			<v-row
				no-gutters
				align="center"
				justify="center"
				class="dynamic-spacing-sm selector-controls-row"
			>
				<v-col
					:class="[
						'mb-2',
						pos_profile.posa_enable_price_list_dropdown
							? 'selector-control-col-half'
							: 'selector-control-col-full',
					]"
				>
					<v-select
						:items="items_group"
						:label="frappe._('Items Group')"
						density="compact"
						variant="solo"
						hide-details
						v-model="item_group"
					></v-select>
				</v-col>
				<v-col
					class="mb-2 selector-control-col-half"
					v-if="pos_profile.posa_enable_price_list_dropdown"
				>
					<v-select
						:items="price_lists"
						:label="frappe._('Price List')"
						density="compact"
						variant="solo"
						hide-details
						v-model="selected_price_list"
						@update:modelValue="on_price_list_change"
					>
					</v-select>
				</v-col>
				<v-col cols="3" class="dynamic-margin-xs">
					<v-btn-toggle v-model="items_view" color="primary" group density="compact" rounded>
						<v-btn size="small" value="list">{{ __("List") }}</v-btn>
						<v-btn size="small" value="card">{{ __("Card") }}</v-btn>
					</v-btn-toggle>
				</v-col>
				<v-col cols="5" class="dynamic-margin-xs">
					<v-btn
						size="small"
						block
						color="warning"
						variant="text"
						@click="show_offers"
						class="action-btn-consistent"
					>
						{{ offersCount }} {{ __("Offers") }}
					</v-btn>
				</v-col>
				<v-col cols="4" class="dynamic-margin-xs">
					<v-btn
						size="small"
						block
						color="primary"
						variant="text"
						@click="show_coupons"
						class="action-btn-consistent"
						>{{ couponsCount }} {{ __("Coupons") }}</v-btn
					>
				</v-col>
			</v-row>
		</v-card>

		<!-- Camera Scanner Component -->
		<CameraScanner
			v-if="pos_profile.posa_enable_camera_scanning"
			ref="cameraScanner"
			:scan-type="pos_profile.posa_camera_scan_type || 'Both'"
			@barcode-scanned="onBarcodeScanned"
		/>
	</div>
</template>

<script type="module">
import format from "../../format";
import _ from "lodash";
import CameraScanner from "./CameraScanner.vue";
import { ensurePosProfile } from "../../../utils/pos_profile.js";
import {
	saveItemUOMs,
	saveItemUOMsBulk,
	getItemUOMs,
	getLocalStock,
	isOffline,
	initializeStockCache,
	getItemsStorage,
	setItemsStorage,
	getLocalStockCache,
	setLocalStockCache,
	initPromise,
	checkDbHealth,
	getCachedPriceListItems,
	savePriceListItems,
	getStoredItems,
	updateLocalStockCache,
	isStockCacheReady,
	getCachedItemDetails,
	saveItemDetailsCache,
	getItemsLastSync,
	setItemsLastSync,
	refreshModifiedItems,
} from "../../../offline/index.js";
import { responsiveMixin } from "../../mixins/responsive.js";
import ItemRateInfoMenu from "./items/ItemRateInfoMenu.vue";

export default {
	mixins: [format, responsiveMixin],
	components: {
		CameraScanner,
		ItemRateInfoMenu,
	},
	data: () => ({
		pos_profile: "",
		flags: {},
		items_view: "list",
		item_group: "ALL",
		loading: false,
		items_group: ["ALL"],
		items: [],
		search: "",
		search_input: "",
		first_search: "",
		search_backup: "",
		// Limit the displayed items to avoid overly large lists
		itemsPerPage: 50,
		offersCount: 0,
		appliedOffersCount: 0,
		couponsCount: 0,
		appliedCouponsCount: 0,
		customer_price_list: null,
		customer: null,
		new_line: false,
		qty: 1,
		selected_price_list: null,
		price_lists: [],
		refresh_interval: null,
		currentRequest: null,
		abortController: null,
		itemDetailsRetryCount: 0,
		itemDetailsRetryTimeout: null,
		items_loaded: false,
		selected_currency: "",
		exchange_rate: 1,
		prePopulateInProgress: false,
		itemWorker: null,
		items_request_token: 0,
		show_item_settings: false,
		hide_qty_decimals: false,
		temp_hide_qty_decimals: false,
		hide_zero_rate_items: false,
		temp_hide_zero_rate_items: false,
		selected_item_index: -1,
		isDragging: false,
		// Track if the current search was triggered by a scanner
		search_from_scanner: false,
		// Background sync state and progress
		sync_in_progress: false,
		sync_progress: 0,
		sync_status: "",
		sync_items_count: 0,
		last_invoice_rates: {},
	}),

	watch: {
		customer: _.debounce(function () {
			if (this.loading && !this.items_loaded) {
				return;
			}

			if (this.pos_profile.posa_force_reload_items) {
				if (this.pos_profile.posa_smart_reload_mode) {
					// When limit search is enabled there may be no items yet.
					// Fallback to full reload if nothing is loaded
					if (!this.items_loaded || !this.filtered_items.length) {
						this.items_loaded = false;
						this.get_items(true);
					} else {
						// Only refresh prices for visible items when smart reload is enabled
						this.$nextTick(() => this.refreshPricesForVisibleItems());
					}
				} else {
					// Fall back to full reload
					this.items_loaded = false;
					this.get_items(true);
				}
				return;
			}
			// When the customer changes, avoid reloading all items.
			// Simply refresh prices for visible items only
			if (this.items_loaded && this.filtered_items && this.filtered_items.length > 0) {
				this.$nextTick(() => this.refreshPricesForVisibleItems());
			} else {
				this.get_items();
			}
		}, 300),
		customer_price_list: _.debounce(function (newValue, oldValue) {
			if (newValue === oldValue || (this.loading && !this.items_loaded)) {
				return;
			}

			// Always reload items when customer price list changes
			this.items_loaded = false;
			this.get_items(true);
		}, 300),
		selected_price_list: _.debounce(function (newValue, oldValue) {
			// Skip first initialization assignment to avoid duplicate startup loading.
			if (!oldValue || newValue === oldValue || (this.loading && !this.items_loaded)) {
				return;
			}

			// Force reload items with the new price list
			this.items_loaded = false;
			this.get_items(true);
		}, 300),
		new_line() {
			this.eventBus.emit("set_new_line", this.new_line);
		},
		filtered_items(new_value, old_value) {
			// Update item details if items changed, only for displayed slice
			if (!this.pos_profile.pose_use_limit_search && new_value.length !== old_value.length) {
				const visibleSlice = new_value.slice(0, this.itemsPerPage || 50);
				this.update_items_details(visibleSlice);
			}

			if (new_value && new_value.length) {
				this.refreshLastInvoiceRates(new_value.slice(0, this.itemsPerPage || 50));
			}

			if (!new_value.length) {
				this.selected_item_index = -1;
				return;
			}

			if (this.selected_item_index >= new_value.length) {
				this.selected_item_index = 0;
			}
		},
		search_input(val) {
			this.first_search = val || "";
			this.selected_item_index = -1;
			this.queueSearchOnChange(this.first_search);
		},

		// Refresh item prices whenever the user changes currency
		selected_currency() {
			this.applyCurrencyConversionToItems();
		},

		// Also react when exchange rate is adjusted manually
		exchange_rate() {
			this.applyCurrencyConversionToItems();
		},
		windowWidth(val) {
			this.adjustItemsPerPage(val, this.windowHeight);
		},
		windowHeight(val) {
			this.adjustItemsPerPage(this.windowWidth, val);
		},
	},

	methods: {
		refreshLastInvoiceRates(itemsSlice) {
			if (!itemsSlice || !itemsSlice.length || !this.customer) {
				return;
			}
			const itemCodes = itemsSlice
				.map((i) => i.item_code)
				.filter((code) => code && !this.last_invoice_rates[code]);

			if (!itemCodes.length) return;

			frappe.call({
				method: "posawesome.posawesome.api.invoices.get_last_invoice_rates",
				args: {
					customer: this.customer,
					item_codes: itemCodes,
					company: (this.pos_profile && this.pos_profile.company) || null,
				},
				callback: (r) => {
					if (r && r.message && Array.isArray(r.message)) {
						const updated = { ...this.last_invoice_rates };
						r.message.forEach((row) => {
							if (row && row.item_code) {
								updated[row.item_code] = {
									rate: row.rate,
									currency: row.currency,
									invoice: row.invoice,
									uom: row.uom,
									posting_date: row.posting_date,
								};
							}
						});
						this.last_invoice_rates = updated;
					}
				},
			});
		},

		getItemRateInfo(item) {
			const profileCurrency = (this.pos_profile && (this.pos_profile.company_currency || this.pos_profile.currency)) || "";
			const entries = [];

			// 1. Last Invoice Rate (Customer Sale)
			const saleRate = this.last_invoice_rates && item && item.item_code ? this.last_invoice_rates[item.item_code] : null;
			if (saleRate && saleRate.rate != null) {
				entries.push({
					key: "sale",
					rowLabel: "Last Invoice Rate",
					available: true,
					rate: Number(saleRate.rate),
					currency: saleRate.currency || profileCurrency,
					uom: saleRate.uom || item.stock_uom || null,
					source: saleRate.invoice || null,
					date: saleRate.posting_date || null,
				});
			} else {
				entries.push({
					key: "sale",
					rowLabel: "Last Invoice Rate",
					available: false,
					rate: null,
					currency: null,
				});
			}

			// 2. Cost / Valuation Rate / Standard Rate
			const standardRate = item && item.standard_rate != null && item.standard_rate !== "" ? Number(item.standard_rate) : null;
			const valuationRate = item && item.valuation_rate != null && item.valuation_rate !== "" ? Number(item.valuation_rate) : null;
			if (standardRate !== null && !isNaN(standardRate) && standardRate > 0) {
				entries.push({
					key: "cost",
					rowLabel: "Standard Rate",
					available: true,
					rate: standardRate,
					currency: profileCurrency,
					uom: item.purchase_uom || item.stock_uom || null,
					source: "Standard Rate",
				});
			} else if (valuationRate !== null && !isNaN(valuationRate) && valuationRate > 0) {
				entries.push({
					key: "cost",
					rowLabel: "Valuation Rate",
					available: true,
					rate: valuationRate,
					currency: profileCurrency,
					uom: item.stock_uom || null,
					source: "Valuation Rate",
				});
			}

			return { entries };
		},

		adjustItemsPerPage(width, height = this.windowHeight) {
			const cardWidth = 200; // approximate width of each item card
			const cardHeight = 160; // approximate height including margins
			const containerHeight = height * 0.68; // card container is ~68% of viewport
			const columns = Math.max(1, Math.floor(width / cardWidth));
			const rows = Math.max(1, Math.floor(containerHeight / cardHeight));
			this.itemsPerPage = columns * rows;
		},
		refreshPricesForVisibleItems() {
			const vm = this;
			if (!vm.filtered_items || vm.filtered_items.length === 0) return;

			vm.loading = true;

			// Cancel previous request if any
			if (vm.currentRequest) {
				vm.abortController.abort();
				vm.currentRequest = null;
			}

			const itemCodes = vm.filtered_items.map((it) => it.item_code);
			const cacheResult = getCachedItemDetails(vm.pos_profile.name, vm.active_price_list, itemCodes);
			const updates = [];

			cacheResult.cached.forEach((det) => {
				const item = vm.filtered_items.find((it) => it.item_code === det.item_code);
				if (item) {
					const upd = {
						actual_qty: det.actual_qty,
						serial_no_data: det.serial_no_data,
						batch_no_data: det.batch_no_data,
					};
					if (det.item_uoms && det.item_uoms.length > 0) {
						upd.item_uoms = det.item_uoms;
						saveItemUOMs(item.item_code, det.item_uoms);
					}
					if (det.rate !== undefined) {
						if (det.rate !== 0 || !item.rate) {
							upd.rate = det.rate;
							upd.price_list_rate = det.price_list_rate || det.rate;
						}
					}
					updates.push({ item, upd });
				}
			});

			if (cacheResult.missing.length === 0) {
				vm.$nextTick(() => {
					updates.forEach(({ item, upd }) => Object.assign(item, upd));
					updateLocalStockCache(cacheResult.cached);
					vm.loading = false;
				});
				return;
			}

			vm.abortController = new AbortController();
			const itemsToFetch = vm.filtered_items.filter((it) => cacheResult.missing.includes(it.item_code));

			frappe.call({
				method: "posawesome.posawesome.api.items.get_items_details",
				args: {
					pos_profile: JSON.stringify(vm.pos_profile),
					items_data: JSON.stringify(itemsToFetch),
					price_list: vm.active_price_list,
				},
				freeze: false,
				signal: vm.abortController.signal,
				callback: function (r) {
					if (r.message) {
						r.message.forEach((updItem) => {
							const item = vm.filtered_items.find((it) => it.item_code === updItem.item_code);
							if (item) {
								const upd = {
									actual_qty: updItem.actual_qty,
									serial_no_data: updItem.serial_no_data,
									batch_no_data: updItem.batch_no_data,
								};
								if (updItem.item_uoms && updItem.item_uoms.length > 0) {
									upd.item_uoms = updItem.item_uoms;
									saveItemUOMs(item.item_code, updItem.item_uoms);
								}
								if (updItem.rate !== undefined) {
									if (updItem.rate !== 0 || !item.rate) {
										upd.rate = updItem.rate;
										upd.price_list_rate = updItem.price_list_rate || updItem.rate;
									}
								}
								updates.push({ item, upd });
							}
						});

						vm.$nextTick(() => {
							updates.forEach(({ item, upd }) => Object.assign(item, upd));
							updateLocalStockCache(r.message);
							saveItemDetailsCache(vm.pos_profile.name, vm.active_price_list, r.message);
							vm.loading = false;
						});
					}
				},
				error: function (err) {
					if (err.name !== "AbortError") {
						console.error("Error fetching item details:", err);
						vm.loading = false;
					}
				},
				error_handlers: {
					"Request Timed Out": function () {},
					"Timeout": function () {},
				},
			});
		},

		show_offers() {
			this.eventBus.emit("show_offers", "true");
		},
		show_coupons() {
			this.eventBus.emit("show_coupons", "true");
		},
		async syncDeltaItems() {
			const vm = this;
			if (!vm.items_loaded || !vm.items || !vm.items.length) {
				return;
			}
			try {
				vm.sync_in_progress = true;
				vm.sync_progress = 15;
				vm.sync_status = vm.__ ? vm.__("Checking for item and price updates...") : "Checking for updates...";
				vm.eventBus.emit("data-load-progress", { name: "items", progress: 15 });

				const res = await refreshModifiedItems(vm.pos_profile, vm.active_price_list, vm.customer);
				vm.sync_progress = 65;

				if (res && res.items && res.items.length > 0) {
					vm.sync_items_count = res.items.length;
					vm.sync_status = vm.__ ? vm.__("Applying updated items...") : "Applying updated items...";
					console.info(`[Delta Sync] Updated ${res.items.length} items from server`);
					const updatedMap = new Map();
					res.items.forEach((it) => {
						if (it && it.item_code) {
							updatedMap.set(it.item_code, it);
						}
					});

					// Update existing items in vm.items or append new ones
					vm.items.forEach((item) => {
						if (updatedMap.has(item.item_code)) {
							const updatedItem = updatedMap.get(item.item_code);
							Object.assign(item, updatedItem);
							updatedMap.delete(item.item_code);
						}
					});

					// Append any brand new items returned in delta
					if (updatedMap.size > 0) {
						for (const newItem of updatedMap.values()) {
							vm.items.push(newItem);
						}
					}

					savePriceListItems(vm.active_price_list, vm.items);
					vm.eventBus.emit("set_all_items", vm.items);
					if (vm.filtered_items && vm.filtered_items.length > 0) {
						vm.update_items_details(vm.filtered_items);
					}
				}

				vm.sync_progress = 100;
				vm.eventBus.emit("data-load-progress", { name: "items", progress: 100 });
				setTimeout(() => {
					vm.sync_in_progress = false;
					vm.sync_progress = 0;
					vm.sync_status = "";
					vm.sync_items_count = 0;
				}, 1200);
			} catch (err) {
				console.error("[Delta Sync] Error during delta refresh:", err);
				vm.sync_in_progress = false;
				vm.sync_progress = 0;
			}
		},
		forceReloadItems() {
			setItemsLastSync(null);
			// Always recreate the worker when forcing a reload so
			// subsequent reloads fetch fresh data from the server.
			if (!this.itemWorker && typeof Worker !== "undefined") {
				try {
					const workerUrl = "/assets/posawesome/js/posapp/workers/itemWorker.js";
					this.itemWorker = new Worker(workerUrl, { type: "classic" });
				} catch (e) {
					console.error("Failed to start item worker", e);
					this.itemWorker = null;
				}
			}
			this.items_loaded = false;
			this.get_items(true);
		},
		async get_items(force_server = false) {
			await initPromise;
			await checkDbHealth();
			const request_token = ++this.items_request_token;
			if (!this.pos_profile) {
				console.error("No POS Profile");
				return;
			}

			if (force_server && this.pos_profile.posa_local_storage) {
				localStorage.setItem("items_storage", "");
			}

			const vm = this;
			this.loading = true;

			// Removed noisy debug log
			let search = this.get_search(this.first_search);
			let gr = vm.item_group !== "ALL" ? vm.item_group.toLowerCase() : "";
			let sr = search || "";

			// Skip reload if items already loaded, not forcing, not searching and limit search disabled
			if (
				this.items_loaded &&
				!force_server &&
				!this.first_search &&
				!this.pos_profile.pose_use_limit_search
			) {
				console.info("Items already loaded, skipping reload");
				if (this.filtered_items && this.filtered_items.length > 0) {
					this.update_items_details(this.filtered_items);
				}
				this.loading = false;
				return;
			}
			// Removed noisy debug log

			// Attempt to load cached items for the current price list
			if (!force_server && !this.pos_profile.pose_use_limit_search) {
				const cached = getCachedPriceListItems(vm.active_price_list);
				if (cached && cached.length) {
					vm.items = cached;
					vm.items.forEach((it) => {
						if (!it.item_uoms || it.item_uoms.length === 0) {
							const cachedUoms = getItemUOMs(it.item_code);
							if (cachedUoms.length > 0) {
								it.item_uoms = cachedUoms;
							} else if (it.stock_uom) {
								it.item_uoms = [{ uom: it.stock_uom, conversion_factor: 1.0 }];
							}
						}
					});
					this.eventBus.emit("set_all_items", vm.items);
					vm.loading = false;
					vm.items_loaded = true;
					vm.eventBus.emit("data-load-progress", { name: "items", progress: 100 });

					if (vm.items && vm.items.length > 0) {
						vm.prePopulateStockCache(vm.items.slice(0, 50));
						const initialSlice = vm.items.slice(0, vm.itemsPerPage || 50);
						vm.update_items_details(initialSlice);
						// Smooth background delta sync to refresh changed prices/quantities
						setTimeout(() => {
							vm.syncDeltaItems();
						}, 300);
					}
					return;
				}

				// Check IndexedDB items table directly without blocking
				try {
					const stored = await getStoredItems();
					if (stored && stored.length > 0) {
						vm.items = stored;
						savePriceListItems(vm.active_price_list, vm.items, false);
						vm.items.forEach((it) => {
							if (!it.item_uoms || it.item_uoms.length === 0) {
								const cachedUoms = getItemUOMs(it.item_code);
								if (cachedUoms.length > 0) {
									it.item_uoms = cachedUoms;
								} else if (it.stock_uom) {
									it.item_uoms = [{ uom: it.stock_uom, conversion_factor: 1.0 }];
								}
							}
						});
						this.eventBus.emit("set_all_items", vm.items);
						vm.loading = false;
						vm.items_loaded = true;
						vm.eventBus.emit("data-load-progress", { name: "items", progress: 100 });

						if (vm.items && vm.items.length > 0) {
							vm.prePopulateStockCache(vm.items.slice(0, 50));
							const initialSlice = vm.items.slice(0, vm.itemsPerPage || 50);
							vm.update_items_details(initialSlice);
							setTimeout(() => {
								vm.syncDeltaItems();
							}, 300);
						}
						return;
					}
				} catch (e) {
					console.warn("Failed to load items from IndexedDB", e);
				}
			}

			// Load from localStorage when available and not forcing
			if (
				vm.pos_profile.posa_local_storage &&
				getItemsStorage().length &&
				!vm.pos_profile.pose_use_limit_search &&
				!force_server
			) {
				vm.items = getItemsStorage();
				// Fallback to cached UOMs when loading from storage
				vm.items.forEach((it) => {
					if (!it.item_uoms || it.item_uoms.length === 0) {
						const cached = getItemUOMs(it.item_code);
						if (cached.length > 0) {
							it.item_uoms = cached;
						} else if (it.stock_uom) {
							it.item_uoms = [{ uom: it.stock_uom, conversion_factor: 1.0 }];
						}
					}
				});
				this.eventBus.emit("set_all_items", vm.items);
				vm.loading = false;
				vm.items_loaded = true;
				vm.eventBus.emit("data-load-progress", { name: "items", progress: 100 });

				if (vm.items && vm.items.length > 0) {
					await vm.prePopulateStockCache(vm.items.slice(0, 50));
					const initialSlice = vm.items.slice(0, vm.itemsPerPage || 50);
					vm.update_items_details(initialSlice);
				}
				return;
			}
			if (!this.itemWorker && typeof Worker !== "undefined") {
				try {
					const workerUrl = "/assets/posawesome/js/posapp/workers/itemWorker.js";
					this.itemWorker = new Worker(workerUrl, { type: "classic" });
				} catch (e) {
					console.error("Failed to start item worker", e);
					this.itemWorker = null;
				}
			}

			if (this.itemWorker) {
				try {
					vm.sync_in_progress = true;
					vm.sync_progress = 5;
					vm.sync_status = vm.__ ? vm.__("Checking catalog size...") : "Checking catalog size...";
					vm.eventBus.emit("data-load-progress", { name: "items", progress: 5 });

					// First get the total count to show real progress percentage
					let totalItemsCount = 0;
					try {
						const countRes = await new Promise((resolve) => {
							frappe.call({
								method: "posawesome.posawesome.api.items.get_items_count",
								args: {
									pos_profile: JSON.stringify(vm.pos_profile),
								},
								callback: (r) => resolve(r.message || 0),
								error: () => resolve(0),
							});
						});
						totalItemsCount = Number(countRes) || 0;
					} catch (e) {
						totalItemsCount = 0;
					}

					const CHUNK_SIZE = 200;
					let offset = 0;
					let allItems = [];
					let hasMore = true;

					while (hasMore) {
						if (vm.items_request_token !== request_token) {
							vm.sync_in_progress = false;
							return;
						}

						const currentOffset = offset;
						vm.sync_status = vm.__
							? vm.__("Syncing items in background")
							: "Syncing items in background";

						if (totalItemsCount > 0) {
							vm.sync_progress = Math.min(95, Math.round((currentOffset / totalItemsCount) * 90) + 5);
						} else {
							vm.sync_progress = Math.min(90, Math.round(5 + (currentOffset / (currentOffset + CHUNK_SIZE)) * 85));
						}
						vm.sync_items_count = currentOffset;
						vm.eventBus.emit("data-load-progress", { name: "items", progress: vm.sync_progress });

						const fetchController = new AbortController();
						const fetchTimeout = setTimeout(() => fetchController.abort(), 30000);

						const res = await fetch("/api/method/posawesome.posawesome.api.items.get_items", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"X-Frappe-CSRF-Token": frappe.csrf_token,
							},
							credentials: "same-origin",
							signal: fetchController.signal,
							body: JSON.stringify({
								pos_profile: JSON.stringify(vm.pos_profile),
								price_list: vm.active_price_list,
								item_group: gr,
								search_value: sr,
								customer: vm.customer,
								limit: CHUNK_SIZE,
								offset: currentOffset,
							}),
						});
						clearTimeout(fetchTimeout);

						if (!res.ok) {
							throw new Error(`Failed to fetch items batch at offset ${currentOffset}: ${res.status}`);
						}

						const jsonRes = await res.json();
						const batch = Array.isArray(jsonRes.message) ? jsonRes.message : [];

						if (batch.length === 0) {
							hasMore = false;
							break;
						}

						allItems.push(...batch);
						offset += batch.length;
						vm.sync_items_count = offset;

						// Send chunk to worker to enrich search index off the main thread and persist to IndexedDB
						await new Promise((resolve) => {
							let resolved = false;
							const timer = setTimeout(() => {
								if (!resolved) {
									resolved = true;
									try {
										vm.itemWorker.removeEventListener("message", handleBatchMessage);
									} catch (e) {}
									resolve();
								}
							}, 5000);

							const handleBatchMessage = (ev) => {
								if (
									(ev.data.type === "batch_processed" && ev.data.batchIndex === currentOffset) ||
									ev.data.type === "error"
								) {
									if (!resolved) {
										resolved = true;
										clearTimeout(timer);
										try {
											vm.itemWorker.removeEventListener("message", handleBatchMessage);
										} catch (e) {}
										resolve();
									}
								}
							};
							vm.itemWorker.addEventListener("message", handleBatchMessage);
							vm.itemWorker.postMessage({
								type: "append_batch",
								items: batch,
								batchIndex: currentOffset,
								isLast: batch.length < CHUNK_SIZE,
								priceList: vm.active_price_list,
							});
						});

						// Update local stock cache from incoming item actual_qty without extra network overhead
						updateLocalStockCache(batch);

						// Display first batch immediately so UI is responsive right away (< 200ms)
						if (currentOffset === 0 && allItems.length > 0) {
							vm.items = allItems.slice();
							vm.eventBus.emit("set_all_items", vm.items);
							vm.loading = false;
							const initialSlice = vm.items.slice(0, vm.itemsPerPage || 50);
							vm.update_items_details(initialSlice);
						}

						if (batch.length < CHUNK_SIZE) {
							hasMore = false;
						}

						// Yield to browser thread so UI stays 100% smooth
						await new Promise((resolve) => setTimeout(resolve, 0));
					}

					// Finalize caching to IndexedDB in worker
					vm.sync_status = vm.__ ? vm.__("Finalizing catalog...") : "Finalizing catalog...";
					vm.sync_progress = 98;
					vm.sync_items_count = allItems.length;

					await new Promise((resolve) => {
						let finalizeResolved = false;
						const finalizeTimer = setTimeout(() => {
							if (!finalizeResolved) {
								finalizeResolved = true;
								try {
									vm.itemWorker.removeEventListener("message", handleFinalize);
								} catch (e) {}
								resolve();
							}
						}, 5000);

						const handleFinalize = (ev) => {
							if (ev.data.type === "cache_finalized" || ev.data.type === "error") {
								if (!finalizeResolved) {
									finalizeResolved = true;
									clearTimeout(finalizeTimer);
									try {
										vm.itemWorker.removeEventListener("message", handleFinalize);
									} catch (e) {}
									if (ev.data.maxModified) {
										setItemsLastSync(ev.data.maxModified);
									}
									resolve();
								}
							}
						};
						vm.itemWorker.addEventListener("message", handleFinalize);
						vm.itemWorker.postMessage({
							type: "finalize_cache",
						});
					});

					// Yield to browser thread before memory updates
					await new Promise((resolve) => setTimeout(resolve, 0));

					// Save into memory cache without re-persisting giant blob on main thread
					vm.items = allItems;
					savePriceListItems(vm.active_price_list, vm.items, false);

					// Bulk cache UOMs in a single debounced pass instead of 10,000 synchronous persists
					saveItemUOMsBulk(allItems);

					// Yield to browser to let UI paint progress 100% smoothly
					await new Promise((resolve) => setTimeout(resolve, 0));

					vm.eventBus.emit("set_all_items", vm.items);
					vm.loading = false;
					vm.items_loaded = true;
					vm.sync_progress = 100;
					vm.sync_status = vm.__ ? vm.__("Items catalog cached successfully") : "Catalog cached";
					vm.eventBus.emit("data-load-progress", { name: "items", progress: 100 });

					setTimeout(() => {
						vm.sync_in_progress = false;
						vm.sync_progress = 0;
						vm.sync_status = "";
						vm.sync_items_count = 0;
					}, 1500);

					console.info(`Items Loaded: ${allItems.length} items chunked successfully`);
					vm.prePopulateStockCache(vm.items.slice(0, 50));

					vm.$nextTick(() => {
						if (vm.search && !vm.pos_profile.pose_use_limit_search) {
							vm.search_onchange();
						}
					});

					if (vm.items && vm.items.length > 0) {
						const initialSlice = vm.items.slice(0, vm.itemsPerPage || 50);
						vm.update_items_details(initialSlice);
					}

					if (vm.pos_profile.pose_use_limit_search) {
						vm.enter_event();
					}
				} catch (err) {
					console.error("Failed to fetch chunked items", err);
					vm.loading = false;
					vm.sync_in_progress = false;
					vm.sync_progress = 0;
				}
			} else {
				frappe.call({
					method: "posawesome.posawesome.api.items.get_items",
					args: {
						pos_profile: JSON.stringify(vm.pos_profile),
						price_list: vm.active_price_list,
						item_group: gr,
						search_value: sr,
						customer: vm.customer,
					},
					callback: async function (r) {
						if (vm.items_request_token !== request_token) return;
						if (r.message) {
							vm.items = r.message;
							// Ensure UOMs are available for each item
							vm.items.forEach((it) => {
								if (it.item_uoms && it.item_uoms.length > 0) {
									saveItemUOMs(it.item_code, it.item_uoms);
								} else {
									const cached = getItemUOMs(it.item_code);
									if (cached.length > 0) {
										it.item_uoms = cached;
									} else if (it.stock_uom) {
										it.item_uoms = [{ uom: it.stock_uom, conversion_factor: 1.0 }];
									}
								}
							});
							vm.eventBus.emit("set_all_items", vm.items);
							vm.loading = false;
							vm.items_loaded = true;
							savePriceListItems(vm.active_price_list, vm.items);
							let maxMod = "";
							for (const it of vm.items) {
								if (it.modified && it.modified > maxMod) maxMod = it.modified;
							}
							if (maxMod) setItemsLastSync(maxMod);
							console.info("Items Loaded");

							// Pre-populate stock cache when items are freshly loaded
							vm.prePopulateStockCache(vm.items);

							vm.$nextTick(() => {
								if (vm.search && !vm.pos_profile.pose_use_limit_search) {
									vm.search_onchange();
								}
							});

							// Always refresh quantities after items are loaded
							if (vm.items && vm.items.length > 0) {
								const initialSlice = vm.items.slice(0, vm.itemsPerPage || 50);
								vm.update_items_details(initialSlice);
							}

							if (vm.pos_profile.pose_use_limit_search) {
								vm.enter_event();
							}
						} else {
							vm.loading = false;
						}
					},
					error: function (err) {
						if (vm.items_request_token !== request_token) return;
						console.error("Failed to fetch items", err);
						vm.loading = false;
					},
				});
			}
		},
		get_items_groups() {
			if (!this.pos_profile) {
				console.log("No POS Profile");
				return;
			}
			if (this.pos_profile.item_groups.length > 0) {
				this.pos_profile.item_groups.forEach((element) => {
					if (element.item_group !== "All Item Groups") {
						this.items_group.push(element.item_group);
					}
				});
			} else {
				const vm = this;
				frappe.call({
					method: "posawesome.posawesome.api.items.get_items_groups",
					args: {},
					callback: function (r) {
						if (r.message) {
							r.message.forEach((element) => {
								vm.items_group.push(element.name);
							});
						}
					},
				});
			}
		},
		async fetch_price_lists() {
			if (this.pos_profile.posa_enable_price_list_dropdown) {
				try {
					const r = await frappe.call({
						method: "posawesome.posawesome.api.posapp.get_selling_price_lists",
					});
					if (r && r.message) {
						this.price_lists = r.message.map((pl) => pl.name);
					}
				} catch (error) {
					console.error("Failed fetching price lists", error);
					this.price_lists = [this.pos_profile.selling_price_list];
				}
			} else {
				// Fallback to the price list defined in the POS Profile
				this.price_lists = [this.pos_profile.selling_price_list];
			}

			if (!this.selected_price_list) {
				this.selected_price_list = this.pos_profile.selling_price_list;
			}

			// Fetch and store currency for the applied price list
			try {
				const r = await frappe.call({
					method: "posawesome.posawesome.api.invoices.get_price_list_currency",
					args: { price_list: this.selected_price_list },
				});
				if (r && r.message) {
					this.price_list_currency = r.message;
				}
			} catch (error) {
				console.error("Failed fetching price list currency", error);
			}

			return this.price_lists;
		},
		on_price_list_change(val) {
			const normalized = typeof val === "object" && val !== null ? val.name || val.value : val;
			this.selected_price_list = normalized || this.pos_profile.selling_price_list;
			this.get_items(true);
			this.eventBus.emit("price_list_changed", this.selected_price_list);
		},

		getItemsHeaders() {
			const items_headers = [
				{
					title: __("Name"),
					align: "start",
					sortable: true,
					key: "item_name",
				},
				{
					title: __("Code"),
					align: "start",
					sortable: true,
					key: "item_code",
				},
				{ title: __("Rate"), key: "rate", align: "start" },
				{ title: __("Available QTY"), key: "actual_qty", align: "start" },
				{ title: __("UOM"), key: "stock_uom", align: "start" },
			];
			if (!this.pos_profile.posa_display_item_code) {
				items_headers.splice(1, 1);
			}

			return items_headers;
		},
		async click_item_row(event, { item }) {
			const rowItem = item?.raw || item;
			const idx = this.filtered_items.findIndex((it) => it.item_code === rowItem?.item_code);
			if (idx >= 0) {
				this.selected_item_index = idx;
			}
			await this.add_item(rowItem);
		},
		handleSearchArrowDown() {
			this.moveItemSelection(1);
		},
		handleSearchArrowUp() {
			this.moveItemSelection(-1);
		},
		moveItemSelection(step) {
			const items = this.filtered_items || [];
			if (!items.length) {
				this.selected_item_index = -1;
				return;
			}

			if (this.selected_item_index === -1) {
				this.selected_item_index = step > 0 ? 0 : items.length - 1;
			} else {
				const length = items.length;
				this.selected_item_index = (this.selected_item_index + step + length) % length;
			}

			this.scrollSelectedItemIntoView();
		},
		isItemSelected(index) {
			return index === this.selected_item_index;
		},
		getListRowProps({ item }) {
			const rowItem = item?.raw || item;
			const idx = this.filtered_items.findIndex((it) => it.item_code === rowItem?.item_code);
			return idx === this.selected_item_index ? { class: "item-row-active" } : {};
		},
		scrollSelectedItemIntoView() {
			if (this.selected_item_index < 0) {
				return;
			}

			this.$nextTick(() => {
				if (this.items_view === "card") {
					const container = this.$refs.itemsContainer;
					const itemEl = container?.querySelector?.(
						`[data-item-index=\"${this.selected_item_index}\"]`,
					);
					if (itemEl?.scrollIntoView) {
						itemEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
					}
					return;
				}

				const tableRoot = this.$el?.querySelector?.(".sleek-data-table");
				const activeRow = tableRoot?.querySelector?.(".item-row-active");
				if (activeRow?.scrollIntoView) {
					activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
					return;
				}

				const tableWrapper = tableRoot?.querySelector?.(".v-table__wrapper");
				if (tableWrapper) {
					const rowHeight = 48;
					tableWrapper.scrollTop = this.selected_item_index * rowHeight;
				}
			});
		},
		async add_item(item) {
			item = { ...item };
			if (item.has_variants) {
				let variants = this.items.filter((it) => it.variant_of == item.item_code);
				if (!variants.length) {
					try {
						const res = await frappe.call({
							method: "posawesome.posawesome.api.items.get_item_variants",
							args: {
								pos_profile: JSON.stringify(this.pos_profile),
								parent_item_code: item.item_code,
								price_list: this.active_price_list,
								customer: this.customer,
							},
						});
						if (res.message) {
							variants = res.message;
							this.items.push(...variants);
						}
					} catch (e) {
						console.error("Failed to fetch variants", e);
					}
				}
				this.eventBus.emit("show_message", {
					title: __("This is an item template. Please choose a variant."),
					color: "warning",
				});
				console.log("sending profile", this.pos_profile);
				// Pass the active price list along with the profile
				this.eventBus.emit(
					"open_variants_model",
					item,
					variants,
					this.pos_profile,
					this.active_price_list,
				);
			} else {
				if (item.actual_qty === 0 && this.pos_profile.posa_display_items_in_stock) {
					this.eventBus.emit("show_message", {
						title: `No stock available for ${item.item_name}`,
						color: "warning",
					});
					await this.update_items_details([item]);
					return;
				}

				// Ensure UOMs are initialized before adding the item
				if (!item.item_uoms || item.item_uoms.length === 0) {
					// If UOMs are not available, fetch them first
					await this.update_items_details([item]);

					// Add stock UOM as fallback
					if (!item.item_uoms || item.item_uoms.length === 0) {
						item.item_uoms = [{ uom: item.stock_uom, conversion_factor: 1.0 }];
					}
				}

				// Ensure correct rate based on selected currency
				if (this.pos_profile.posa_allow_multi_currency) {
					this.applyCurrencyConversionToItem(item);

					// Compute base rates from original values
					const base_rate =
						item.original_currency === this.pos_profile.currency
							? item.original_rate
							: item.original_rate * (item.plc_conversion_rate || this.exchange_rate);
					item.base_rate = base_rate;
					item.base_price_list_rate = base_rate;
				}

				// Customer last selling rate is resolved centrally via get_item_detail
				// in Invoice update_item_detail() to avoid race/overwrite issues.

				if (!item.qty || item.qty === 1) {
					let qtyVal = this.qty != null ? this.qty : 1;
					qtyVal = Math.abs(qtyVal);
					if (this.hide_qty_decimals) {
						qtyVal = Math.trunc(qtyVal);
					}
					item.qty = qtyVal;
				}
				this.eventBus.emit("add_item", item);
				this.qty = 1;
			}
		},
		async enter_event() {
			let match = false;
			if (!this.filtered_items.length || !this.first_search) {
				return;
			}
			const qty = this.get_item_qty(this.first_search);
			const new_item = { ...this.filtered_items[0] };
			new_item.qty = flt(qty);
			const searchCode = String(this.search || this.first_search || "").trim();

			// Check item barcodes for exact match and get the UOM for that barcode
			let matchedBarcodeRow = null;
			if (Array.isArray(new_item.item_barcode)) {
				matchedBarcodeRow = new_item.item_barcode.find(
					(b) => b && String(b.barcode || "").trim() === searchCode,
				);
			}
			if (!matchedBarcodeRow && Array.isArray(new_item.barcodes)) {
				matchedBarcodeRow = new_item.barcodes.find((b) => {
					const code = typeof b === "object" ? b.barcode : b;
					return String(code || "").trim() === searchCode;
				});
			}

			if (matchedBarcodeRow) {
				const barcodeUom = typeof matchedBarcodeRow === "object"
					? (matchedBarcodeRow.uom || matchedBarcodeRow.posa_uom)
					: null;
				if (barcodeUom) {
					new_item.uom = barcodeUom;
				}
				match = true;
			} else if (String(new_item.barcode || "").trim() === searchCode) {
				match = true;
			} else if (String(new_item.item_code || "").trim().toLowerCase() === searchCode.toLowerCase()) {
				match = true;
			} else if (this.filtered_items.length === 1) {
				match = true;
			}
			if (
				!new_item.to_set_serial_no &&
				new_item.has_serial_no &&
				this.pos_profile.posa_search_serial_no
			) {
				new_item.serial_no_data.forEach((element) => {
					if (this.search && element.serial_no == this.search) {
						new_item.to_set_serial_no = this.first_search;
						match = true;
					}
				});
			}
			if (this.flags.serial_no) {
				new_item.to_set_serial_no = this.flags.serial_no;
			}
			if (!new_item.to_set_batch_no && new_item.has_batch_no && this.pos_profile.posa_search_batch_no) {
				new_item.batch_no_data.forEach((element) => {
					if (this.search && element.batch_no == this.search) {
						new_item.to_set_batch_no = this.first_search;
						new_item.batch_no = this.first_search;
						match = true;
					}
				});
			}
			if (this.flags.batch_no) {
				new_item.to_set_batch_no = this.flags.batch_no;
			}
			if (match) {
				await this.add_item(new_item);
				this.flags.serial_no = null;
				this.flags.batch_no = null;
				this.qty = 1;
				// Clear search field after successfully adding an item
				this.clearSearch();
				this.$refs.debounce_search.focus();
			}
		},
		queueSearchOnChange: _.debounce(function (newSearchTerm) {
			this.search_onchange(newSearchTerm);
		}, 300),
		async handleSearchEnter(event) {
			if (event) {
				event.preventDefault();
			}

			const selectedItem =
				this.selected_item_index >= 0 ? this.filtered_items[this.selected_item_index] : null;
			if (selectedItem) {
				await this.add_item({ ...selectedItem });
				return;
			}

			if (this.queueSearchOnChange && this.queueSearchOnChange.cancel) {
				this.queueSearchOnChange.cancel();
			}
			this.search_onchange(this.search_input);
		},
		search_onchange(newSearchTerm) {
			const vm = this;

			// Determine the actual query string and trim whitespace
			const query = typeof newSearchTerm === "string" ? newSearchTerm : vm.first_search;
			vm.first_search = query || "";

			vm.search = (query || "").trim();

			if (!vm.search) {
				vm.search_from_scanner = false;
				return;
			}

			// --- SCALE BARCODE LOGIC ---
			const scaleData = vm.parseScaleBarcode(vm.search);

			if (scaleData) {
				const item = vm.items.find((it) => it.item_code === scaleData.item_code);
				if (item) {
					let qty = 1,
						rate = item.rate;
					if (vm.pos_profile.custom_barcode_type === "Weight Code") {
						qty = scaleData.value / 1000;
					} else if (vm.pos_profile.custom_barcode_type === "Item Price") {
						rate = scaleData.value / 100;
					}
					const newItem = { ...item, qty, rate };
					vm.add_item(newItem);
					frappe.show_alert(
						{ message: `Added: ${item.item_name} (${qty} / ${rate})`, indicator: "green" },
						3,
					);
					vm.clearSearch();
					vm.$refs.debounce_search && vm.$refs.debounce_search.focus();
					vm.search_from_scanner = false;
					return;
				}
			}
			// --- END SCALE BARCODE LOGIC ---

			const fromScanner = vm.search_from_scanner;

			if (vm.pos_profile.pose_use_limit_search) {
				// Only trigger search when query length meets minimum threshold
				if (vm.search && vm.search.length >= 3) {
					vm.get_items();
					vm.fetch_price_lists();
				}
			} else {
				if (vm.search && vm.search.length >= 3) {
					vm.enter_event();
				}

				// After search, update quantities for newly filtered items
				if (vm.filtered_items && vm.filtered_items.length > 0) {
					setTimeout(() => {
						vm.update_items_details(vm.filtered_items);
					}, 300);
				}
			}

			// Clear the input only when triggered via scanner
			if (fromScanner) {
				vm.clearSearch();
				vm.$refs.debounce_search && vm.$refs.debounce_search.focus();
				vm.search_from_scanner = false;
			}
		},
		get_item_qty(first_search) {
			const qtyVal = this.qty != null ? this.qty : 1;
			let scal_qty = Math.abs(qtyVal);
			// Only apply scale barcode logic when first 2 codes are "21"
			if (
				first_search.startsWith(this.pos_profile.posa_scale_barcode_start) &&
				first_search.substr(0, 2) === "21"
			) {
				let pesokg1 = first_search.substr(7, 5);
				let pesokg;
				if (pesokg1.startsWith("0000")) {
					pesokg = "0.00" + pesokg1.substr(4);
				} else if (pesokg1.startsWith("000")) {
					pesokg = "0.0" + pesokg1.substr(3);
				} else if (pesokg1.startsWith("00")) {
					pesokg = "0." + pesokg1.substr(2);
				} else if (pesokg1.startsWith("0")) {
					pesokg = pesokg1.substr(1, 1) + "." + pesokg1.substr(2, pesokg1.length);
				} else if (!pesokg1.startsWith("0")) {
					pesokg = pesokg1.substr(0, 2) + "." + pesokg1.substr(2, pesokg1.length);
				}
				scal_qty = pesokg;
			}
			if (this.hide_qty_decimals) {
				scal_qty = Math.trunc(scal_qty);
			}
			return scal_qty;
		},
		get_search(first_search) {
			let search_term = "";
			// Only apply scale barcode logic when first 2 codes are "21"
			if (
				first_search &&
				first_search.startsWith(this.pos_profile.posa_scale_barcode_start) &&
				first_search.substr(0, 2) === "21"
			) {
				search_term = first_search.substr(0, 7);
			} else {
				search_term = first_search;
			}
			return search_term;
		},
		toggleItemSearchFocus() {
			this.$nextTick(() => {
				const searchField = this.$refs.debounce_search;
				if (!searchField) {
					return;
				}

				const searchInput = searchField.$el?.querySelector?.("input") || null;
				if (searchInput && document.activeElement === searchInput) {
					searchInput.blur();
					return;
				}

				if (typeof searchField.focus === "function") {
					searchField.focus();
				} else if (searchInput) {
					searchInput.focus();
				}

				if (searchInput && typeof searchInput.select === "function") {
					searchInput.select();
				}
			});
		},
		esc_event(event) {
			const hasActiveDialog = !!document.querySelector(
				".v-overlay-container .v-overlay--active, .v-dialog.v-dialog--active, .modal.show",
			);
			if (hasActiveDialog) {
				return;
			}

			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}

			this.toggleItemSearchFocus();
		},
		async update_items_details(items) {
			const vm = this;
			if (!items || !items.length) return;

			// reset any pending retry timer
			if (vm.itemDetailsRetryTimeout) {
				clearTimeout(vm.itemDetailsRetryTimeout);
				vm.itemDetailsRetryTimeout = null;
			}

			const itemCodes = items.map((it) => it.item_code);
			const cacheResult = getCachedItemDetails(vm.pos_profile.name, vm.active_price_list, itemCodes);
			cacheResult.cached.forEach((det) => {
				const item = items.find((it) => it.item_code === det.item_code);
				if (item) {
					Object.assign(item, {
						actual_qty: det.actual_qty,
						serial_no_data: det.serial_no_data,
						batch_no_data: det.batch_no_data,
						has_batch_no: det.has_batch_no,
						has_serial_no: det.has_serial_no,
					});
					if (det.item_uoms && det.item_uoms.length > 0) {
						item.item_uoms = det.item_uoms;
						saveItemUOMs(item.item_code, det.item_uoms);
					}
					if (det.rate !== undefined) {
						if (det.rate !== 0 || !item.rate) {
							item.rate = det.rate;
							item.price_list_rate = det.price_list_rate || det.rate;
						}
					}

					if (!item.original_rate) {
						item.original_rate = item.rate;
						item.original_currency = item.currency || vm.pos_profile.currency;
					}

					vm.applyCurrencyConversionToItem(item);
				}
			});

			let allCached = cacheResult.missing.length === 0;
			items.forEach((item) => {
				const localQty = getLocalStock(item.item_code);
				if (localQty !== null) {
					item.actual_qty = localQty;
				} else {
					allCached = false;
				}

				if (!item.item_uoms || item.item_uoms.length === 0) {
					const cachedUoms = getItemUOMs(item.item_code);
					if (cachedUoms.length > 0) {
						item.item_uoms = cachedUoms;
					} else if (isOffline()) {
						item.item_uoms = [{ uom: item.stock_uom, conversion_factor: 1.0 }];
					} else {
						allCached = false;
					}
				}
			});

			// When offline or everything is cached, skip server call
			if (isOffline() || allCached) {
				vm.itemDetailsRetryCount = 0;
				return;
			}

			// Cancel previous request
			if (vm.currentRequest) {
				vm.abortController.abort();
				vm.currentRequest = null;
			}

			vm.abortController = new AbortController();

			// Only fetch missing items that are not template variants.
			// Limit batch size to 50 items max to prevent blocking the server and UI thread!
			const itemsToFetch = items
				.filter((it) => cacheResult.missing.includes(it.item_code) && !it.has_variants)
				.slice(0, 50);

			if (itemsToFetch.length === 0) {
				vm.itemDetailsRetryCount = 0;
				return;
			}

			try {
				vm.currentRequest = await frappe.call({
					method: "posawesome.posawesome.api.items.get_items_details",
					args: {
						pos_profile: JSON.stringify(vm.pos_profile),
						items_data: JSON.stringify(itemsToFetch),
						price_list: vm.active_price_list,
					},
					freeze: false,
					signal: vm.abortController.signal,
					error_handlers: {
						"Request Timed Out": function () {},
						"Timeout": function () {},
					},
				});

				const r = vm.currentRequest;
				if (r && r.message) {
					vm.itemDetailsRetryCount = 0;
					let qtyChanged = false;
					let updatedItems = [];

					items.forEach((item) => {
						const updated_item = r.message.find((element) => element.item_code == item.item_code);
						if (updated_item) {
							const prev_qty = item.actual_qty;

							updatedItems.push({
								item: item,
								updates: {
									actual_qty: updated_item.actual_qty,
									serial_no_data: updated_item.serial_no_data,
									batch_no_data: updated_item.batch_no_data,
									has_batch_no: updated_item.has_batch_no,
									has_serial_no: updated_item.has_serial_no,
									item_uoms:
										updated_item.item_uoms && updated_item.item_uoms.length > 0
											? updated_item.item_uoms
											: item.item_uoms,
								},
							});

							if (prev_qty > 0 && updated_item.actual_qty === 0) {
								qtyChanged = true;
							}

							if (updated_item.item_uoms && updated_item.item_uoms.length > 0) {
								saveItemUOMs(item.item_code, updated_item.item_uoms);
							}
						}
					});

					updatedItems.forEach(({ item, updates }) => {
						Object.assign(item, updates);
						vm.applyCurrencyConversionToItem(item);
					});

					updateLocalStockCache(r.message);
					saveItemDetailsCache(vm.pos_profile.name, vm.active_price_list, r.message);

					if (qtyChanged) {
						vm.$forceUpdate();
					}
				}
			} catch (err) {
				if (err.name !== "AbortError") {
					console.error("Error fetching item details:", err);
					items.forEach((item) => {
						const localQty = getLocalStock(item.item_code);
						if (localQty !== null) {
							item.actual_qty = localQty;
						}
						if (!item.item_uoms || item.item_uoms.length === 0) {
							const cached = getItemUOMs(item.item_code);
							if (cached.length > 0) {
								item.item_uoms = cached;
							}
						}
					});

					if (!isOffline()) {
						vm.itemDetailsRetryCount += 1;
						const delay = Math.min(32000, 1000 * Math.pow(2, vm.itemDetailsRetryCount - 1));
						vm.itemDetailsRetryTimeout = setTimeout(() => {
							vm.update_items_details(items);
						}, delay);
					}
				}
			}

			// Cleanup on component destroy
			this.cleanupBeforeDestroy = () => {
				if (vm.abortController) {
					vm.abortController.abort();
				}
			};
		},
		update_cur_items_details() {
			if (this.filtered_items && this.filtered_items.length > 0) {
				this.update_items_details(this.filtered_items);
			}
		},
		async prePopulateStockCache(items) {
			if (this.prePopulateInProgress) {
				return;
			}
			this.prePopulateInProgress = true;
			try {
				if (isStockCacheReady()) {
					return;
				}
				const itemsToInit = Array.isArray(items) ? items.slice(0, 50) : [];
				await initializeStockCache(itemsToInit, this.pos_profile);
			} catch (error) {
				console.error("Failed to pre-populate stock cache:", error);
			} finally {
				this.prePopulateInProgress = false;
			}
		},

		// Update loaded items prices when price list changes
		updateLoadedItemsPrices() {
			if (!this.items || this.items.length === 0) return;

			const priceList = this.active_price_list;
			const cached = getCachedPriceListItems(priceList);

			if (cached && cached.length > 0) {
				const map = {};
				cached.forEach((ci) => {
					map[ci.item_code] = ci;
				});

				this.items.forEach((item) => {
					const cachedItem = map[item.item_code];
					if (cachedItem) {
						item.rate = cachedItem.rate || cachedItem.price_list_rate;
						item.price_list_rate = cachedItem.price_list_rate || cachedItem.rate;
					}
				});

				this.$forceUpdate();
			}
		},

		applyCurrencyConversionToItems() {
			if (!this.items || !this.items.length) return;
			this.items.forEach((it) => this.applyCurrencyConversionToItem(it));
		},

		applyCurrencyConversionToItem(item) {
			if (!item) return;
			const base = this.pos_profile.currency;

			if (!item.original_rate) {
				item.original_rate = item.rate;
				item.original_currency = item.currency || base;
			}

			// original_rate is in price list currency
			const price_list_rate = item.original_rate;

			// Determine base rate using available conversion info
			const base_rate = price_list_rate * (item.plc_conversion_rate || 1);

			item.base_rate = base_rate;
			item.base_price_list_rate = price_list_rate;

			// If the price list currency matches the selected currency,
			// don't apply any conversion
			const converted_rate =
				item.original_currency === this.selected_currency
					? price_list_rate
					: price_list_rate * (this.exchange_rate || 1);

			item.rate = this.flt(converted_rate, this.currency_precision);
			item.currency = this.selected_currency;
			item.price_list_rate = item.rate;
		},
		scan_barcoud() {
			const vm = this;
			try {
				// Check if scanner is already attached to document
				if (document._scannerAttached) {
					return;
				}

				onScan.attachTo(document, {
					suffixKeyCodes: [],
					keyCodeMapper: function (oEvent) {
						oEvent.stopImmediatePropagation();
						oEvent.preventDefault();
						return onScan.decodeKeyEvent(oEvent);
					},
					onScan: function (sCode) {
						setTimeout(() => {
							vm.trigger_onscan(sCode);
						}, 300);
					},
				});

				// Mark document as having scanner attached
				document._scannerAttached = true;
			} catch (error) {
				console.warn("Scanner initialization error:", error.message);
			}
		},
		trigger_onscan(sCode) {
			// indicate this search came from a scanner
			this.search_from_scanner = true;
			// apply scanned code as search term
			this.search_input = sCode;
			this.first_search = sCode;
			this.search = sCode;

			this.$nextTick(() => {
				if (this.filtered_items.length == 0) {
					this.eventBus.emit("show_message", {
						title: `No Item has this barcode "${sCode}"`,
						color: "error",
					});
					frappe.utils.play_sound("error");
				} else {
					this.enter_event();
				}

				// clear search field for next scan and refocus input
				this.clearSearch();
				this.$refs.debounce_search && this.$refs.debounce_search.focus();
			});
		},
		generateWordCombinations(inputString) {
			const words = inputString.split(" ");
			const wordCount = words.length;
			const combinations = [];

			// Helper function to generate all permutations
			function permute(arr, m = []) {
				if (arr.length === 0) {
					combinations.push(m.join(" "));
				} else {
					for (let i = 0; i < arr.length; i++) {
						const current = arr.slice();
						const next = current.splice(i, 1);
						permute(current.slice(), m.concat(next));
					}
				}
			}

			permute(words);

			return combinations;
		},
		getSearchResultType() {
			return (this.pos_profile?.posa_search_result_type || "Contains").toLowerCase();
		},
		parseSearchTermGroups(term) {
			const normalized = String(term || "")
				.toLowerCase()
				.trim();
			if (!normalized) {
				return [];
			}

			return normalized
				.split(/\s+or\s+/)
				.map((group) =>
					group
						.split(/\s+/)
						.map((token) => token.trim())
						.filter(Boolean),
				)
				.filter((group) => group.length > 0);
		},
		matchSearchValue(value, term) {
			if (!value && value !== 0) return false;
			const haystack = String(value).toLowerCase();
			const needle = String(term || "").toLowerCase();
			const searchType = this.getSearchResultType();

			if (!needle) return true;
			if (searchType === "prefix") {
				return haystack.startsWith(needle);
			}
			if (searchType === "exact") {
				return haystack === needle;
			}
			if (searchType === "any word") {
				const groups = this.parseSearchTermGroups(needle);
				if (!groups.length) {
					return true;
				}

				// Group logic: tokens in a group are AND, groups are OR.
				return groups.some((group) => group.every((token) => haystack.includes(token)));
			}

			return haystack.includes(needle);
		},
		clearSearch() {
			this.search_backup = this.search_input;
			if (this.queueSearchOnChange && this.queueSearchOnChange.cancel) {
				this.queueSearchOnChange.cancel();
			}
			this.search_input = "";
			this.first_search = "";
			this.search = "";
			this.selected_item_index = -1;
			// No need to call get_items() again
		},

		restoreSearch() {
			if (this.search_input === "") {
				this.search_input = this.search_backup;
				this.first_search = this.search_backup;
				this.search = this.search_backup;
				this.queueSearchOnChange(this.search_backup);
				// No need to reload items when focus is lost
			}
		},
		handleItemSearchFocus() {
			if (this.queueSearchOnChange && this.queueSearchOnChange.cancel) {
				this.queueSearchOnChange.cancel();
			}
			this.search_input = "";
			this.first_search = "";
			this.search = "";
			this.selected_item_index = -1;
			// Optionally, you might want to also clear search_backup if the behaviour should be a full reset on focus
			// this.search_backup = "";
		},

		clearQty() {
			this.qty = null;
		},

		startCameraScanning() {
			if (this.$refs.cameraScanner) {
				this.$refs.cameraScanner.startScanning();
			}
		},
		onBarcodeScanned(scannedCode) {
			console.log("Barcode scanned:", scannedCode);

			// mark this search as coming from a scanner
			this.search_from_scanner = true;

			// Clear any previous search
			this.search_input = "";
			this.search = "";
			this.first_search = "";

			// Set the scanned code as search term
			this.search_input = scannedCode;
			this.first_search = scannedCode;
			this.search = scannedCode;

			// Show scanning feedback
			frappe.show_alert(
				{
					message: `Scanning for: ${scannedCode}`,
					indicator: "blue",
				},
				2,
			);

			// Enhanced item search and submission logic
			setTimeout(() => {
				this.processScannedItem(scannedCode);
			}, 300);
		},
		// Parse scale barcode: DDIIIIIWWWWC or DDIIIIIPPPPC
		parseScaleBarcode(barcode) {
			// Must be at least 12 chars (DDIIIIIWWWWC)
			if (!barcode || barcode.length < 12) return null;
			const dept = barcode.substr(0, 2);
			// Only apply scale barcode logic when first 2 codes are "21"
			if (dept !== "21") return null;
			const itemCode = barcode.substr(2, 5);
			const value = barcode.substr(7, 5); // 5 digits for weight/price
			const typeChar = barcode.substr(11, 1); // C
			return {
				department: dept,
				item_code: itemCode,
				value: value,
				typeChar: typeChar,
			};
		},

		async processScannedItem(scannedCode) {
			const scaleData = this.parseScaleBarcode(scannedCode);
			if (scaleData) {
				const item = this.items.find((it) => it.item_code === scaleData.item_code);
				if (item) {
					let qty = 1,
						rate = item.rate;
					if (this.pos_profile.custom_barcode_type === "Weight Code") {
						qty = parseFloat(scaleData.value) / 1000;
					} else if (this.pos_profile.custom_barcode_type === "Item Price") {
						rate = parseFloat(scaleData.value) / 100;
					}
					const newItem = { ...item, qty, rate };
					await this.add_item(newItem);
					frappe.show_alert(
						{ message: `Added: ${item.item_name} (${qty} / ${rate})`, indicator: "green" },
						3,
					);
					this.clearSearch();
					this.$refs.debounce_search && this.$refs.debounce_search.focus();
					return;
				}
			}
			// Fallback to default barcode processing
			let foundItem = this.items.find(
				(item) =>
					item.barcode === scannedCode ||
					item.item_code === scannedCode ||
					(item.barcodes && item.barcodes.some((bc) => bc.barcode === scannedCode)) ||
					(item.item_barcode && item.item_barcode.some((bc) => bc.barcode === scannedCode)),
			);

			if (foundItem) {
				console.log("Found item by exact match:", foundItem);
				this.addScannedItemToInvoice(foundItem, scannedCode);
				return;
			}

			// If no exact match, try partial search
			const searchResults = this.searchItemsByCode(scannedCode);

			if (searchResults.length === 1) {
				console.log("Found item by search:", searchResults[0]);
				this.addScannedItemToInvoice(searchResults[0], scannedCode);
			} else if (searchResults.length > 1) {
				// Multiple matches - show selection dialog
				this.showMultipleItemsDialog(searchResults, scannedCode);
			} else {
				// No matches found in loaded items, query backend
				await this.handleItemNotFound(scannedCode);
			}
		},
		searchItemsByCode(code) {
			return this.items.filter((item) => {
				const searchTerm = code.toLowerCase();
				return (
					this.matchSearchValue(item.item_code, searchTerm) ||
					this.matchSearchValue(item.item_name, searchTerm) ||
					(item.barcode && this.matchSearchValue(item.barcode, searchTerm)) ||
					(item.barcodes &&
						item.barcodes.some((bc) => this.matchSearchValue(bc.barcode, searchTerm))) ||
					(item.item_barcode &&
						item.item_barcode.some((bc) => this.matchSearchValue(bc.barcode, searchTerm)))
				);
			});
		},
		async addScannedItemToInvoice(item, scannedCode) {
			console.log("Adding scanned item to invoice:", item, scannedCode);

			let newItem = { ...item };
			// Check if scannedCode matches a barcode with a specific UOM
			let matchedUom = null;
			let barcodeList = [];
			if (item.item_barcode && Array.isArray(item.item_barcode)) {
				barcodeList = barcodeList.concat(item.item_barcode);
			}
			if (item.barcodes && Array.isArray(item.barcodes)) {
				barcodeList = barcodeList.concat(item.barcodes);
			}
			const matchedBc = barcodeList.find((b) => b.barcode === scannedCode);
			if (matchedBc && (matchedBc.uom || matchedBc.posa_uom)) {
				matchedUom = matchedBc.uom || matchedBc.posa_uom;
			}

			if (matchedUom) {
				newItem.uom = matchedUom;
			}

			// Use existing add_item method with enhanced feedback
			await this.add_item(newItem);

			// Show success message
			frappe.show_alert(
				{
					message: `Added: ${item.item_name}${matchedUom ? ` (${matchedUom})` : ""}`,
					indicator: "green",
				},
				3,
			);

			// Clear search after successful addition and refocus input
			this.clearSearch();
			this.$refs.debounce_search && this.$refs.debounce_search.focus();
		},
		showMultipleItemsDialog(items, scannedCode) {
			// Create a dialog to let user choose from multiple matches
			const dialog = new frappe.ui.Dialog({
				title: __("Multiple Items Found"),
				fields: [
					{
						fieldtype: "HTML",
						fieldname: "items_html",
						options: this.generateItemSelectionHTML(items, scannedCode),
					},
				],
				primary_action_label: __("Cancel"),
				primary_action: () => dialog.hide(),
			});

			dialog.show();

			// Add click handlers for item selection
			setTimeout(() => {
				items.forEach((item, index) => {
					const button = dialog.$wrapper.find(`[data-item-index="${index}"]`);
					button.on("click", () => {
						this.addScannedItemToInvoice(item, scannedCode);
						dialog.hide();
					});
				});
			}, 100);
		},
		generateItemSelectionHTML(items, scannedCode) {
			let html = `<div class="mb-3"><strong>Scanned Code:</strong> ${scannedCode}</div>`;
			html += '<div class="item-selection-list">';

			items.forEach((item, index) => {
				html += `
		  <div class="item-option p-3 mb-2 border rounded cursor-pointer" data-item-index="${index}" style="border: 1px solid #ddd; cursor: pointer;">
			<div class="d-flex align-items-center">
			  <img src="${item.image || "/assets/posawesome/js/posapp/components/pos/placeholder-image.png"}" 
				   style="width: 50px; height: 50px; object-fit: cover; margin-right: 15px;" />
			  <div>
				<div class="font-weight-bold">${item.item_name}</div>
				<div class="text-muted small">${item.item_code}</div>
				<div class="text-primary">${this.format_currency(item.rate, this.pos_profile.currency, this.ratePrecision(item.rate))}</div>
			  </div>
			</div>
		  </div>
		`;
			});

			html += "</div>";
			return html;
		},
		async handleItemNotFound(scannedCode) {
			console.warn("Item not found locally for scanned code:", scannedCode);

			// Try fetching from backend barcode API
			try {
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_items_from_barcode",
					args: {
						barcode: scannedCode,
						pos_profile: JSON.stringify(this.pos_profile),
					},
				});

				if (res && res.message && res.message.length > 0) {
					const backendItem = res.message[0];
					await this.add_item(backendItem);
					frappe.show_alert(
						{
							message: `Added: ${backendItem.item_name}${backendItem.uom ? ` (${backendItem.uom})` : ""}`,
							indicator: "green",
						},
						3,
					);
					this.clearSearch();
					this.$refs.debounce_search && this.$refs.debounce_search.focus();
					return;
				}
			} catch (err) {
				console.error("Error looking up barcode from backend:", err);
			}

			// Show error message
			frappe.show_alert(
				{
					message: `Item not found: ${scannedCode}`,
					indicator: "red",
				},
				5,
			);

			// Keep the search term for manual search
			this.trigger_onscan(scannedCode);
		},

		currencySymbol(currency) {
			return get_currency_symbol(currency);
		},
		format_currency(value, currency, precision) {
			const prec = typeof precision === "number" ? precision : this.currency_precision;
			return this.formatCurrency(value, prec);
		},
		ratePrecision(value) {
			const numericValue = typeof value === "string" ? parseFloat(value) : value;
			return Number.isInteger(numericValue) ? 0 : this.currency_precision;
		},
		format_number(value, precision) {
			const prec = typeof precision === "number" ? precision : this.float_precision;
			return this.formatFloat(value, prec);
		},
		hasDecimalPrecision(value) {
			// Check if the value has any decimal precision when converted by exchange rate
			if (this.exchange_rate && this.exchange_rate !== 1) {
				let convertedValue = value * this.exchange_rate;
				return !Number.isInteger(convertedValue);
			}
			return !Number.isInteger(value);
		},

		toggleItemSettings() {
			this.temp_hide_qty_decimals = this.hide_qty_decimals;
			this.temp_hide_zero_rate_items = this.hide_zero_rate_items;
			this.show_item_settings = true;
		},
		cancelItemSettings() {
			this.show_item_settings = false;
		},
		applyItemSettings() {
			this.hide_qty_decimals = this.temp_hide_qty_decimals;
			this.hide_zero_rate_items = this.temp_hide_zero_rate_items;
			this.saveItemSettings();
			this.show_item_settings = false;
		},
		onDragStart(event, item) {
			this.isDragging = true;

			// Set drag data
			event.dataTransfer.setData(
				"application/json",
				JSON.stringify({
					type: "item-from-selector",
					item: item,
				}),
			);

			// Set drag effect
			event.dataTransfer.effectAllowed = "copy";

			// Emit event to show drop feedback in ItemsTable
			this.eventBus.emit("item-drag-start", item);
		},
		onDragEnd(event) {
			this.isDragging = false;

			// Emit event to hide drop feedback
			this.eventBus.emit("item-drag-end");
		},
		saveItemSettings() {
			try {
				const settings = {
					hide_qty_decimals: this.hide_qty_decimals,
					hide_zero_rate_items: this.hide_zero_rate_items,
				};
				localStorage.setItem("posawesome_item_selector_settings", JSON.stringify(settings));
			} catch (e) {
				console.error("Failed to save item selector settings:", e);
			}
		},
		loadItemSettings() {
			try {
				const saved = localStorage.getItem("posawesome_item_selector_settings");
				if (saved) {
					const opts = JSON.parse(saved);
					if (typeof opts.hide_qty_decimals === "boolean") {
						this.hide_qty_decimals = opts.hide_qty_decimals;
					}
					if (typeof opts.hide_zero_rate_items === "boolean") {
						this.hide_zero_rate_items = opts.hide_zero_rate_items;
					}
				}
			} catch (e) {
				console.error("Failed to load item selector settings:", e);
			}
		},
		handleGlobalTypeToSearchKeydown(event) {
			if (!event || event.defaultPrevented || event.repeat || event.isComposing) {
				return;
			}
			if (event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}
			// Only alphanumeric and standard typing characters (single character)
			if (!event.key || event.key.length !== 1) {
				return;
			}
			if (!/^[\p{L}\p{N}\-._/\\]$/u.test(event.key)) {
				return;
			}

			const active = document.activeElement;
			if (active && active !== document.body) {
				const tagName = active.tagName;
				if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
					return;
				}
				if (active.isContentEditable || active.getAttribute("contenteditable") === "true") {
					return;
				}
				if (active.closest && active.closest("input, textarea, select, [contenteditable='true']")) {
					return;
				}
			}

			// Don't intercept if an active modal or dialog is currently displayed
			const activeOverlays = document.querySelectorAll(
				".v-overlay__content:not([style*='display: none']), .v-dialog--active, .modal.show",
			);
			const hasVisibleDialog = Array.from(activeOverlays).some((dialog) => {
				if (!(dialog instanceof HTMLElement) || !dialog.isConnected) return false;
				const style = window.getComputedStyle ? window.getComputedStyle(dialog) : null;
				if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
					return false;
				}
				const rect = dialog.getBoundingClientRect ? dialog.getBoundingClientRect() : null;
				return Boolean(rect && rect.width > 0 && rect.height > 0);
			});
			if (hasVisibleDialog) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (!this.search_input) {
				this.search_input = event.key;
			} else {
				this.search_input += event.key;
			}

			this.$nextTick(() => {
				const searchInputEl =
					document.querySelector("input[name='posa_item_search_no_autofill']") ||
					(this.$refs.debounce_search && this.$refs.debounce_search.$el
						? this.$refs.debounce_search.$el.querySelector("input")
						: null);

				if (searchInputEl && typeof searchInputEl.focus === "function") {
					searchInputEl.focus();
					if (typeof searchInputEl.setSelectionRange === "function") {
						const len = searchInputEl.value.length;
						searchInputEl.setSelectionRange(len, len);
					}
				} else if (this.$refs.debounce_search && typeof this.$refs.debounce_search.focus === "function") {
					this.$refs.debounce_search.focus();
				}
				this.search_onchange(this.search_input);
			});
		},
	},

	computed: {
		clampedSyncProgress() {
			const normalized = Number(this.sync_progress);
			if (!Number.isFinite(normalized) || normalized <= 0) {
				return 0;
			}
			return Math.min(100, Math.round(normalized));
		},
		normalizedSyncItemsCount() {
			const normalized = Number(this.sync_items_count);
			if (!Number.isFinite(normalized) || normalized <= 0) {
				return 0;
			}
			return Math.round(normalized);
		},
		syncItemsCountLabel() {
			const count = this.normalizedSyncItemsCount;
			const itemLabel =
				count === 1
					? this.__
						? this.__("item synced")
						: "item synced"
					: this.__
						? this.__("items synced")
						: "items synced";
			return `${count.toLocaleString()} ${itemLabel}`;
		},
		headers() {
			return this.getItemsHeaders();
		},
		filtered_items() {
			this.search = this.get_search(this.first_search).trim();
			if (!this.pos_profile.pose_use_limit_search) {
				let filtred_list = [];
				let filtred_group_list = [];
				if (this.item_group != "ALL") {
					filtred_group_list = this.items.filter((item) =>
						item.item_group.toLowerCase().includes(this.item_group.toLowerCase()),
					);
				} else {
					filtred_group_list = this.items;
				}
				if (!this.search || this.search.length < 3) {
					let filtered = [];
					if (
						this.pos_profile.posa_show_template_items &&
						this.pos_profile.posa_hide_variants_items
					) {
						filtered = filtred_group_list
							.filter((item) => !item.variant_of)
							.slice(0, this.itemsPerPage);
					} else {
						filtered = filtred_group_list.slice(0, this.itemsPerPage);
					}

					if (this.hide_zero_rate_items) {
						filtered = filtered.filter((item) => parseFloat(item.rate) !== 0);
					}

					// Ensure quantities are defined
					filtered.forEach((item) => {
						if (item.actual_qty === undefined) {
							item.actual_qty = 0;
						}
					});

					return filtered;
				} else if (this.search) {
					const term = this.search.toLowerCase();
					// Match barcode directly
					filtred_list = filtred_group_list.filter((item) =>
						item.item_barcode.some((b) => b.barcode === this.search),
					);

					if (filtred_list.length === 0) {
						// Match by code or name using configured search result type
						filtred_list = filtred_group_list.filter(
							(item) =>
								this.matchSearchValue(item.item_code, term) ||
								this.matchSearchValue(item.item_name, term),
						);
					}

					if (filtred_list.length === 0 && this.pos_profile.posa_search_serial_no) {
						filtred_list = filtred_group_list.filter((item) => {
							for (let element of item.serial_no_data) {
								if (element.serial_no === this.search) {
									this.flags.serial_no = this.search;
									return true;
								}
							}
							return false;
						});
					}

					if (filtred_list.length === 0 && this.pos_profile.posa_search_batch_no) {
						filtred_list = filtred_group_list.filter((item) => {
							for (let element of item.batch_no_data) {
								if (element.batch_no === this.search) {
									this.flags.batch_no = this.search;
									return true;
								}
							}
							return false;
						});
					}
				}

				let final_filtered_list = [];
				if (this.pos_profile.posa_show_template_items && this.pos_profile.posa_hide_variants_items) {
					final_filtered_list = filtred_list
						.filter((item) => !item.variant_of)
						.slice(0, this.itemsPerPage);
				} else {
					final_filtered_list = filtred_list.slice(0, this.itemsPerPage);
				}

				if (this.hide_zero_rate_items) {
					final_filtered_list = final_filtered_list.filter((item) => parseFloat(item.rate) !== 0);
				}

				// Ensure quantities are defined for each item
				final_filtered_list.forEach((item) => {
					if (item.actual_qty === undefined) {
						item.actual_qty = 0;
					}
				});

				// Item details will be refreshed via watchers when the filtered
				// list length changes. Removing the automatic call here prevents
				// redundant requests each time this computed property re-evaluates.

				return final_filtered_list;
			} else {
				const items_list = this.items.slice(0, this.itemsPerPage);

				// Ensure quantities are defined
				items_list.forEach((item) => {
					if (item.actual_qty === undefined) {
						item.actual_qty = 0;
					}
				});

				if (this.hide_zero_rate_items) {
					return items_list.filter((item) => parseFloat(item.rate) !== 0);
				}

				return items_list;
			}
		},
		debounce_qty: {
			get() {
				// Display the raw quantity while typing to avoid forced decimal format
				if (this.qty === null || this.qty === "") return "";
				return this.hide_qty_decimals ? Math.trunc(this.qty) : this.qty;
			},
			set: _.debounce(function (value) {
				let parsed = parseFloat(String(value).replace(/,/g, ""));
				if (isNaN(parsed)) {
					parsed = null;
				}
				if (this.hide_qty_decimals && parsed != null) {
					parsed = Math.trunc(parsed);
				}
				this.qty = parsed;
			}, 200),
		},
		isDarkTheme() {
			return this.$theme.current === "dark";
		},
		active_price_list() {
			return (
				this.customer_price_list ||
				this.selected_price_list ||
				(this.pos_profile && this.pos_profile.selling_price_list)
			);
		},
	},

	created: function () {
		this.loadItemSettings();
		if (typeof Worker !== "undefined") {
			try {
				// Use the plain URL so the service worker can match the cached file
				// even when offline. Using a query string causes cache lookups to fail
				// which results in "Failed to fetch a worker script" errors.
				const workerUrl = "/assets/posawesome/js/posapp/workers/itemWorker.js";
				this.itemWorker = new Worker(workerUrl, { type: "classic" });

				this.itemWorker.onerror = function (event) {
					console.error("Worker error:", event);
					console.error("Message:", event.message);
					console.error("Filename:", event.filename);
					console.error("Line number:", event.lineno);
				};
				console.log("Created worker nowwwwww");
			} catch (e) {
				console.error("Failed to start item worker", e);
				this.itemWorker = null;
			}
		}
		this.$nextTick(function () {});
		this.eventBus.on("register_pos_profile", async (data) => {
			await initPromise;
			await checkDbHealth();
			this.pos_profile = data.pos_profile;
			this.customer = (data.pos_profile && data.pos_profile.customer) || this.customer || null;
			this.items_loaded = false;
			if (this.pos_profile.posa_force_reload_items && !this.pos_profile.posa_smart_reload_mode) {
				await this.get_items(true);
			} else {
				await this.get_items();
			}
			this.get_items_groups();
			this.items_view = this.pos_profile.posa_default_card_view ? "card" : "list";
			this.fetch_price_lists();
		});
		this.eventBus.on("closing_shift_submit_success", () => {
			this.items_loaded = false;
			this.items = [];
			this.filtered_items = [];
		});
		this.eventBus.on("update_cur_items_details", () => {
			this.update_cur_items_details();
		});
		this.eventBus.on("update_offers_counters", (data) => {
			this.offersCount = data.offersCount;
			this.appliedOffersCount = data.appliedOffersCount;
		});
		this.eventBus.on("update_coupons_counters", (data) => {
			this.couponsCount = data.couponsCount;
			this.appliedCouponsCount = data.appliedCouponsCount;
		});
		this.eventBus.on("update_customer_price_list", (data) => {
			this.customer_price_list = data;
		});
		this.eventBus.on("update_selected_price_list", (data) => {
			this.selected_price_list = data;
		});
		this.eventBus.on("update_customer", (data) => {
			if (typeof data === "string") {
				this.customer = data || null;
			} else if (data && typeof data === "object") {
				this.customer = data.name || data.customer || null;
			} else {
				this.customer = null;
			}
		});

		// Manually trigger a full item reload when requested
		this.eventBus.on("force_reload_items", async () => {
			this.items_loaded = false;
			await this.get_items(true);
		});

		// Refresh item quantities when connection to server is restored
		this.eventBus.on("server-online", async () => {
			this.update_cur_items_details();
		});

		// Refresh visible item quantities initially once items are available
		this.update_cur_items_details();

		// Add new event listener for currency changes
		this.eventBus.on("update_currency", (data) => {
			this.selected_currency = data.currency;
			this.exchange_rate = data.exchange_rate;

			// Refresh visible item prices when currency changes
			this.applyCurrencyConversionToItems();
			this.update_cur_items_details();
		});
	},

	async mounted() {
		const profile = await ensurePosProfile();
		if (!this.pos_profile) {
			this.pos_profile = profile;
		}
		this.scan_barcoud();
		// grid layout adjusts automatically with CSS, set items per page based on device size
		this.adjustItemsPerPage(this.windowWidth, this.windowHeight);

		// Listen for refocus event after item is added
		this.eventBus.on("refocus_item_search", () => {
			this.$nextTick(() => {
				const searchInputEl =
					document.querySelector("input[name='posa_item_search_no_autofill']") ||
					(this.$refs.debounce_search && this.$refs.debounce_search.$el
						? this.$refs.debounce_search.$el.querySelector("input")
						: null);
				if (searchInputEl && typeof searchInputEl.focus === "function") {
					searchInputEl.focus();
				} else if (this.$refs.debounce_search && typeof this.$refs.debounce_search.focus === "function") {
					this.$refs.debounce_search.focus();
				}
			});
		});
		this.eventBus.on("toggle_item_search_focus", this.toggleItemSearchFocus);

		// Global type-to-search listener (auto-types characters into search without clicking)
		document.addEventListener("keydown", this.handleGlobalTypeToSearchKeydown, true);
	},

	beforeUnmount() {
		document.removeEventListener("keydown", this.handleGlobalTypeToSearchKeydown, true);
		// Clear interval when component is destroyed
		if (this.refresh_interval) {
			clearInterval(this.refresh_interval);
		}

		if (this.itemDetailsRetryTimeout) {
			clearTimeout(this.itemDetailsRetryTimeout);
		}
		this.itemDetailsRetryCount = 0;
		if (this.queueSearchOnChange && this.queueSearchOnChange.cancel) {
			this.queueSearchOnChange.cancel();
		}

		// Call cleanup function for abort controller
		if (this.cleanupBeforeDestroy) {
			this.cleanupBeforeDestroy();
		}

		// Detach scanner if it was attached
		if (document._scannerAttached) {
			try {
				onScan.detachFrom(document);
				document._scannerAttached = false;
			} catch (error) {
				console.warn("Scanner detach error:", error.message);
			}
		}

		if (this.itemWorker) {
			this.itemWorker.terminate();
		}

		this.eventBus.off("update_currency");
		this.eventBus.off("server-online");
		this.eventBus.off("register_pos_profile");
		this.eventBus.off("update_cur_items_details");
		this.eventBus.off("update_offers_counters");
		this.eventBus.off("update_coupons_counters");
		this.eventBus.off("update_customer_price_list");
		this.eventBus.off("update_customer");
		this.eventBus.off("force_reload_items");
		this.eventBus.off("refocus_item_search");
		this.eventBus.off("toggle_item_search_focus");
	},
};
</script>

<style scoped>
.dynamic-card {
	composes: pos-card;
}

.dynamic-padding {
	/* Equal spacing on all sides for consistent alignment */
	padding: var(--dynamic-sm);
}

.dynamic-scroll {
	transition: max-height var(--transition-normal);
	padding-bottom: var(--dynamic-xs);
	overflow-y: auto;
	scrollbar-gutter: stable;
}

.items-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: var(--dynamic-sm);
	align-items: start;
	align-content: start;
}

.dynamic-item-card {
	margin: var(--dynamic-xs);
	transition: var(--transition-normal);
	background-color: var(--surface-secondary);
	display: flex;
	flex-direction: column;
	height: auto;
	box-sizing: border-box;
}

.dynamic-item-card .v-img {
	object-fit: contain;
}

.dynamic-item-card:hover {
	transform: scale(calc(1 + 0.02 * var(--font-scale)));
}

.dynamic-item-card--active {
	outline: 2px solid rgb(var(--v-theme-primary));
	outline-offset: 0;
	box-shadow: var(--shadow-md) !important;
}

:deep(.item-row-active td) {
	background-color: rgba(var(--v-theme-primary), 0.12) !important;
}

.text-success {
	color: #4caf50 !important;
}

.sleek-data-table {
	composes: pos-table;
	margin: var(--dynamic-xs);
}

.sleek-data-table:hover {
	box-shadow: var(--shadow-md) !important;
}

.settings-container {
	display: flex;
	align-items: center;
}

.truncate {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* Light mode card backgrounds */
.selection,
.cards {
	background-color: var(--surface-secondary) !important;
}

/* Consistent spacing with navbar and system */
.dynamic-spacing-sm {
	padding: var(--dynamic-sm) !important;
}

.selector-controls-row {
	row-gap: var(--dynamic-xs);
}

.selector-control-col-half {
	flex: 1 1 calc(50% - var(--dynamic-xs));
	min-width: 220px;
}

.selector-control-col-full {
	flex: 1 1 100%;
}

.action-btn-consistent {
	margin-top: var(--dynamic-xs) !important;
	padding: var(--dynamic-xs) var(--dynamic-sm) !important;
	transition: var(--transition-normal) !important;
}

.action-btn-consistent:hover {
	background-color: rgba(25, 118, 210, 0.1) !important;
	transform: translateY(-1px) !important;
}

/* Ensure consistent spacing with navbar pattern */
.cards {
	margin-top: var(--dynamic-sm) !important;
	padding: var(--dynamic-sm) !important;
}

.search-sync-progress {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 0 6px 2px;
	animation: sync-progress-fade-in 160ms ease-out;
}

:deep(.search-sync-progress .v-progress-linear) {
	border-radius: 999px;
	overflow: hidden;
	box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.08);
}

.search-sync-progress__meta {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.search-sync-progress__label,
.search-sync-progress__value {
	font-size: 0.7rem;
	line-height: 1.2;
	color: var(--pos-primary-variant, #2563eb);
}

.search-sync-progress__label {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
	font-weight: 600;
	letter-spacing: 0.01em;
}

.search-sync-progress__count {
	font-variant-numeric: tabular-nums;
	font-weight: 700;
	opacity: 0.82;
}

.search-sync-progress__value {
	font-variant-numeric: tabular-nums;
	font-weight: 700;
}

@keyframes sync-progress-fade-in {
	from {
		opacity: 0;
		transform: translateY(-2px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

/* Responsive breakpoints */
@media (max-width: 768px) {
	.dynamic-padding {
		/* Reduce spacing uniformly on smaller screens */
		padding: var(--dynamic-xs);
	}

	.dynamic-spacing-sm {
		padding: var(--dynamic-xs) !important;
	}

	.selector-control-col-half {
		flex-basis: 100%;
		min-width: 0;
	}

	.action-btn-consistent {
		padding: var(--dynamic-xs) !important;
		font-size: 0.875rem !important;
	}
}

@media (max-width: 480px) {
	.dynamic-padding {
		padding: var(--dynamic-xs);
	}

	.cards {
		padding: var(--dynamic-xs) !important;
	}
}
</style>
