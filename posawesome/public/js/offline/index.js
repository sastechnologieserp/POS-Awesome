// Main entry point - re-exports all functions for backward compatibility

// Core exports
export {
	db,
	initPromise,
	persist,
	addToPersistQueue,
	checkDbHealth,
	initPersistWorker,
	terminatePersistWorker,
	KEY_TABLE_MAP,
	tableForKey,
	LARGE_KEYS,
	LOCAL_STORAGE_KEYS,
	BASE_SCHEMA,
} from "./core.js";

// Cache exports
export {
	memory,
	memoryInitPromise,
	startupInitPromise,
	STARTUP_MEMORY_KEYS,
	hydrateMemoryKeys,
	getStoredItems,
	getStoredItemsCount,
	saveItemsBulk,
	getItemsStorage,
	setItemsStorage,
	getCustomerStorage,
	setCustomerStorage,
	getSalesPersonsStorage,
	setSalesPersonsStorage,
	getOpeningStorage,
	setOpeningStorage,
	clearOpeningStorage,
	getOpeningDialogStorage,
	setOpeningDialogStorage,
	getTaxTemplate,
	setTaxTemplate,
	setLastSyncTotals,
	getLastSyncTotals,
	getItemsLastSync,
	setItemsLastSync,
	getTaxInclusiveSetting,
	setTaxInclusiveSetting,
	isManualOffline,
	setManualOffline,
	toggleManualOffline,
	queueHealthCheck,
	purgeOldQueueEntries,
	MAX_QUEUE_ITEMS,
	resetOfflineState,
	clearAllCache,
	forceClearAllCache,
	getCacheUsageEstimate,
} from "./cache.js";

// Stock exports
export {
	initializeStockCache,
	isStockCacheReady,
	setStockCacheReady,
	validateStockForOfflineInvoice,
	updateLocalStock,
	getLocalStock,
	updateLocalStockCache,
	clearLocalStockCache,
	getLocalStockCache,
	setLocalStockCache,
	fetchItemStockQuantities,
	updateLocalStockWithActualQuantities,
} from "./stock.js";

// Sync exports
export {
	isOffline,
	saveOfflineInvoice,
	getOfflineInvoices,
	clearOfflineInvoices,
	deleteOfflineInvoice,
	getPendingOfflineInvoiceCount,
	saveOfflinePayment,
	getOfflinePayments,
	clearOfflinePayments,
	deleteOfflinePayment,
	getPendingOfflinePaymentCount,
	saveOfflineCustomer,
	updateOfflineInvoicesCustomer,
	getOfflineCustomers,
	clearOfflineCustomers,
	syncOfflineInvoices,
	syncOfflineCustomers,
	syncOfflinePayments,
} from "./sync.js";

// Items exports
export {
	saveItemUOMs,
	saveItemUOMsBulk,
	getItemUOMs,
	saveOffers,
	getCachedOffers,
	savePriceListItems,
	getCachedPriceListItems,
	clearPriceListCache,
	saveItemDetailsCache,
	getCachedItemDetails,
	refreshModifiedItems,
} from "./items.js";

// Customers exports
export {
	saveCustomerBalance,
	getCachedCustomerBalance,
	clearCustomerBalanceCache,
	clearExpiredCustomerBalances,
} from "./customers.js";
