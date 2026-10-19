/* eslint-env worker */
/* global Dexie */

try {
	importScripts("/assets/posawesome/js/libs/dexie.min.js");
} catch (e) {
	try {
		importScripts("/assets/posawesome/dist/js/libs/dexie.min.js");
	} catch (e2) {
		console.error("Failed to load dexie.min.js in worker", e2);
	}
}

const db = new Dexie("posawesome_offline");

const BASE_SCHEMA = {
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

db.version(1).stores({ keyval: "&key" });
db.version(2).stores(BASE_SCHEMA);
for (let v = 7; v <= 18; v++) {
	db.version(v).stores(BASE_SCHEMA);
}

const dbReady = (async () => {
	try {
		await db.open();
	} catch (err) {
		console.error("Failed to open IndexedDB in worker", err);
	}
	return db;
})();

const KEY_TABLE_MAP = {
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

function tableForKey(key) {
	return KEY_TABLE_MAP[key] || "keyval";
}

const normalizeSearchValue = (value) =>
	String(value || "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();

const uniqueStrings = (values) =>
	Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));

const deriveItemSearchFields = (it) => {
	const barcodes = uniqueStrings([
		...(Array.isArray(it.item_barcode)
			? it.item_barcode.map((b) => b && b.barcode)
			: it.item_barcode
				? [String(it.item_barcode)]
				: []),
		...(Array.isArray(it.barcodes)
			? it.barcodes.map((entry) => (entry && typeof entry === "object" ? entry.barcode : entry))
			: []),
	]);
	const nameKeywords = uniqueStrings(it.item_name ? normalizeSearchValue(it.item_name).split(/\s+/) : []);
	const itemCodeLc = normalizeSearchValue(it.item_code);
	const itemNameLc = normalizeSearchValue(it.item_name);
	const barcodesLc = barcodes.map(normalizeSearchValue).filter(Boolean);
	const nameKeywordsLc = nameKeywords.map(normalizeSearchValue).filter(Boolean);

	return {
		barcodes,
		name_keywords: nameKeywords,
		item_code_lc: itemCodeLc,
		item_name_lc: itemNameLc,
		barcodes_lc: barcodesLc,
		name_keywords_lc: nameKeywordsLc,
		search_text: [itemCodeLc, itemNameLc, ...barcodesLc, ...nameKeywordsLc].filter(Boolean).join(" "),
	};
};

async function safeBulkPut(tableName, rows) {
	if (!rows || !rows.length) return;
	const table = db.table(tableName);
	try {
		await db.transaction("rw", table, async () => {
			await table.bulkPut(rows);
		});
	} catch (error) {
		console.warn(`Worker bulkPut failed for ${tableName}; retrying one-by-one`, error);
		await db.transaction("rw", table, async () => {
			for (const row of rows) {
				await table.put(row);
			}
		});
	}
}

async function bulkPutItems(items, syncedAt = Date.now()) {
	try {
		await dbReady;
		if (!db.isOpen()) await db.open();
		const CHUNK_SIZE = 200;
		const table = db.table("items");
		for (let i = 0; i < items.length; i += CHUNK_SIZE) {
			const chunk = items.slice(i, i + CHUNK_SIZE).map((item) => ({
				...item,
				synced_at: syncedAt,
			}));
			await safeBulkPut("items", chunk);
		}
	} catch (e) {
		console.error("Worker bulkPut items failed", e);
	}
}

async function bulkPutPrices(priceList, items, syncedAt = Date.now()) {
	try {
		if (!priceList || !items || !items.length) return;
		await dbReady;
		if (!db.isOpen()) await db.open();
		const records = items.map((it) => {
			const price = it.price_list_rate ?? it.rate ?? 0;
			return {
				price_list: priceList,
				item_code: it.item_code,
				rate: price,
				price_list_rate: price,
				timestamp: syncedAt,
			};
		});
		await safeBulkPut("item_prices", records);
	} catch (e) {
		console.error("Worker bulkPut prices failed", e);
	}
}

async function persistBatch(entries) {
	await dbReady;
	if (!db.isOpen()) await db.open();

	const rowsByTable = new Map();
	for (const entry of entries || []) {
		if (!entry || !entry.key) continue;
		const tableName = tableForKey(entry.key);
		const rows = rowsByTable.get(tableName) || [];
		rows.push({ key: entry.key, value: entry.value });
		rowsByTable.set(tableName, rows);
	}

	await Promise.all(
		Array.from(rowsByTable.entries()).map(([tableName, rows]) => safeBulkPut(tableName, rows)),
	);
}

async function persist(key, value) {
	try {
		await dbReady;
		if (!db.isOpen()) await db.open();
		const tableName = tableForKey(key);
		await safeBulkPut(tableName, [{ key, value }]);
		if (tableName !== "keyval") {
			await safeBulkPut("keyval", [{ key, value }]);
		}
	} catch (e) {
		console.error(`Worker persist failed for ${key}`, e);
	}
}

let latestModified = "";

self.onmessage = async (event) => {
	const data = event.data || {};

	if (data.type === "append_batch") {
		try {
			const batchRaw = Array.isArray(data.items) ? data.items : [];
			const syncTimestamp = data.syncedAt || Date.now();

			for (const it of batchRaw) {
				if (it && it.modified && it.modified > latestModified) {
					latestModified = it.modified;
				}
			}

			const enrichedBatch = batchRaw.map((it) => {
				const searchFields = deriveItemSearchFields(it);
				return {
					item_code: it.item_code,
					item_name: it.item_name,
					description: it.description,
					stock_uom: it.stock_uom,
					image: it.image,
					item_group: it.item_group,
					rate: it.rate,
					price_list_rate: it.price_list_rate,
					currency: it.currency,
					item_barcode: it.item_barcode,
					item_uoms: it.item_uoms,
					actual_qty: it.actual_qty,
					has_batch_no: it.has_batch_no,
					has_serial_no: it.has_serial_no,
					batch_no_data: Array.isArray(it.batch_no_data) ? it.batch_no_data : [],
					serial_no_data: Array.isArray(it.serial_no_data) ? it.serial_no_data : [],
					has_variants: !!it.has_variants,
					...searchFields,
					serials: Array.isArray(it.serial_no_data)
						? it.serial_no_data.map((s) => s && s.serial_no).filter(Boolean)
						: [],
					batches: Array.isArray(it.batch_no_data)
						? it.batch_no_data.map((b) => b && b.batch_no).filter(Boolean)
						: [],
				};
			});

			// Direct persistence to IndexedDB tables in the worker thread
			await bulkPutItems(enrichedBatch, syncTimestamp);
			if (data.priceList) {
				await bulkPutPrices(data.priceList, enrichedBatch, syncTimestamp);
			}

			self.postMessage({
				type: "batch_processed",
				items: enrichedBatch,
				batchIndex: data.batchIndex,
				isLast: Boolean(data.isLast),
			});
		} catch (err) {
			console.error("Worker append_batch error", err);
			self.postMessage({ type: "error", error: err?.message || String(err), batchIndex: data.batchIndex });
		}
	} else if (data.type === "bulk_put_items") {
		try {
			await bulkPutItems(data.items || [], data.syncedAt || Date.now());
			self.postMessage({ type: "items_saved" });
		} catch (err) {
			self.postMessage({ type: "error", error: err?.message || String(err) });
		}
	} else if (data.type === "finalize_cache") {
		try {
			self.postMessage({
				type: "cache_finalized",
				maxModified: latestModified || null,
			});
		} catch (err) {
			console.error("Worker finalize_cache error", err);
			self.postMessage({ type: "error", error: err?.message || String(err) });
		}
	} else if (data.type === "persist_batch") {
		try {
			await persistBatch(data.entries);
			self.postMessage({ type: "persisted_batch", batchId: data.batchId });
		} catch (error) {
			console.error("Worker persist_batch failed", error);
			self.postMessage({ type: "persist_batch_failed", batchId: data.batchId, error: error?.message });
		}
	} else if (data.type === "persist") {
		await persist(data.key, data.value);
		self.postMessage({ type: "persisted", key: data.key });
	} else if (data.type === "parse_and_cache") {
		try {
			const parsed = JSON.parse(data.json);
			const itemsRaw = parsed.message || parsed;
			const syncTimestamp = data.syncedAt || Date.now();
			const enrichedItems = (Array.isArray(itemsRaw) ? itemsRaw : []).map((it) => ({
				...it,
				...deriveItemSearchFields(it),
			}));

			await bulkPutItems(enrichedItems, syncTimestamp);
			if (data.priceList) {
				await bulkPutPrices(data.priceList, enrichedItems, syncTimestamp);
			}

			self.postMessage({
				type: "parsed",
				items: enrichedItems,
			});
		} catch (err) {
			console.error("Worker parse_and_cache error", err);
			self.postMessage({ type: "error", error: err?.message || String(err) });
		}
	}
};
