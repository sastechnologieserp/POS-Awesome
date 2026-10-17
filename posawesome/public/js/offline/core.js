import Dexie from "dexie";
import { withWriteLock } from "./db-utils.js";

// --- Dexie initialization ---------------------------------------------------
export const db = new Dexie("posawesome_offline");

export const BASE_SCHEMA = {
	keyval: "&key",
	queue: "&key",
	write_queue:
		"++queue_id,entity_type,status,resource,next_attempt_at,created_at,last_attempt_at,retry_count,&idempotency_key,[entity_type+status],[status+next_attempt_at]",
	invoice_outbox:
		"++outbox_id,&client_request_id,status,resource,created_at,next_retry_at,nextAttemptAt,retry_count,[status+next_retry_at],[resource+status],[status+nextAttemptAt]",
	cache: "&key",
	items: "&item_code,item_name,item_group,*barcodes,*name_keywords,*serials,*batches",
	item_prices: "&[price_list+item_code],price_list,item_code",
	customers: "&name,customer_name,mobile_no,email_id,tax_id",
	pos_profiles: "&name",
	opening_shifts: "&name,user,pos_profile",
	local_stock: "&key",
	coupons: "&key",
	item_groups: "&key",
	translations: "&key",
	pricing_rules: "&key",
	settings: "&key",
	sync_state: "&key,resourceId,status,nextRetryAt,lastAttemptAt,updated_at",
};

// Start with version 1 and upgrade to BASE_SCHEMA across all versions to ensure
// clean upgrades and complete compatibility with existing databases and workers.
db.version(1).stores({ keyval: "&key" });
db.version(2).stores(BASE_SCHEMA);
for (let v = 7; v <= 18; v++) {
	db.version(v).stores(BASE_SCHEMA);
}

export const KEY_TABLE_MAP = {
	offline_invoices: "queue",
	offline_customers: "queue",
	offline_payments: "queue",
	offline_cash_movements: "queue",
	item_details_cache: "cache",
	stored_value_snapshot_cache: "cache",
	gift_card_snapshot_cache: "cache",
	delivery_charges_cache: "cache",
	currency_options_cache: "cache",
	exchange_rate_cache: "cache",
	price_list_meta_cache: "cache",
	customer_addresses_cache: "cache",
	payment_method_currency_cache: "cache",
	local_stock_cache: "local_stock",
	coupons_cache: "coupons",
	item_groups_cache: "item_groups",
	translation_cache: "translations",
	pricing_rules_snapshot: "pricing_rules",
	pricing_rules_context: "pricing_rules",
	pricing_rules_last_sync: "pricing_rules",
	pricing_rules_stale_at: "pricing_rules",
	cache_version: "settings",
	cache_ready: "settings",
	stock_cache_ready: "settings",
	manual_offline: "settings",
	invoice_outbox_mode: "settings",
	bootstrap_snapshot: "settings",
	bootstrap_snapshot_status: "settings",
	bootstrap_limited_mode: "settings",
	schema_signature: "settings",
	items_last_sync: "sync_state",
	customers_last_sync: "sync_state",
	payment_methods_last_sync: "sync_state",
	pos_last_sync_totals: "sync_state",
};

export function tableForKey(key) {
	return KEY_TABLE_MAP[key] || "keyval";
}

export const LARGE_KEYS = new Set([
	"items",
	"item_details_cache",
	"local_stock_cache",
	"price_list_cache",
	"items_storage",
]);

export const LOCAL_STORAGE_KEYS = new Set([
	"manual_offline",
	"tax_inclusive",
	"cache_version",
	"cache_ready",
	"stock_cache_ready",
]);

export async function checkDbHealth() {
	try {
		if (!db.isOpen()) {
			await db.open();
		}
		await db.table("keyval").get("health_check");
		return true;
	} catch (e) {
		console.error("IndexedDB health check failed", e);
		try {
			if (db.isOpen()) {
				await db.close();
			}
			await Dexie.delete("posawesome_offline");
			await db.open();
		} catch (re) {
			console.error("Failed to recover IndexedDB", re);
		}
		return false;
	}
}

let persistWorker = null;

export function initPersistWorker() {
	if (persistWorker || typeof Worker === "undefined") return;
	try {
		const workerUrl = "/assets/posawesome/js/posapp/workers/itemWorker.js";
		persistWorker = new Worker(workerUrl, { type: "classic" });
	} catch (e) {
		console.error("Failed to init persist worker", e);
		persistWorker = null;
	}
}

export function terminatePersistWorker() {
	if (persistWorker) {
		try {
			persistWorker.terminate();
		} catch (e) {
			console.error("Failed to terminate persist worker", e);
		}
		persistWorker = null;
	}
}

// Initialize worker immediately
initPersistWorker();

// Persist queue for batching operations
const persistQueue = {};
let persistTimeout = null;

export function addToPersistQueue(key, value) {
	persistQueue[key] = value;

	if (!persistTimeout) {
		persistTimeout = setTimeout(flushPersistQueue, 100);
	}
}

function flushPersistQueue() {
	const keys = Object.keys(persistQueue);
	if (keys.length) {
		keys.forEach((key) => {
			persist(key, persistQueue[key]);
			delete persistQueue[key];
		});
	}
	persistTimeout = null;
}

export function persist(key, value) {
	if (persistWorker) {
		let cleanValue = value;
		try {
			if (typeof structuredClone === "function") {
				cleanValue = structuredClone(value);
			} else {
				cleanValue = JSON.parse(JSON.stringify(value));
			}
		} catch (e) {
			cleanValue = value;
		}
		try {
			persistWorker.postMessage({ type: "persist", key, value: cleanValue });
		} catch (e) {
			console.error(`Failed to postMessage for ${key}`, e);
		}
	} else {
		const table = tableForKey(key);
		withWriteLock(async () => {
			try {
				if (!db.isOpen()) await db.open();
				await db.table(table).put({ key, value });
			} catch (e) {
				console.error(`Failed to persist ${key} to ${table}`, e);
			}
		});
	}

	// Mirror only lightweight keys to localStorage, never large datasets
	if (typeof localStorage !== "undefined" && LOCAL_STORAGE_KEYS.has(key) && !LARGE_KEYS.has(key)) {
		try {
			localStorage.setItem(`posa_${key}`, JSON.stringify(value));
		} catch (err) {
			console.error("Failed to persist", key, "to localStorage", err);
		}
	}
}

export const initPromise = new Promise((resolve) => {
	const init = async () => {
		try {
			await db.open();
			resolve();
		} catch (e) {
			console.error("Failed to initialize offline DB", e);
			resolve();
		}
	};

	if (typeof requestIdleCallback === "function") {
		requestIdleCallback(init);
	} else {
		setTimeout(init, 0);
	}
});
