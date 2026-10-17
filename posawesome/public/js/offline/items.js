import { memory, getItemsLastSync, setItemsLastSync } from "./cache.js";
import { persist, addToPersistQueue } from "./core.js";

export function saveItemUOMs(itemCode, uoms) {
	try {
		const cache = memory.uom_cache || {};
		cache[itemCode] = uoms;
		memory.uom_cache = cache;
		addToPersistQueue("uom_cache", memory.uom_cache);
	} catch (e) {
		console.error("Failed to cache UOMs", e);
	}
}

export function saveItemUOMsBulk(items) {
	try {
		const cache = memory.uom_cache || {};
		let updated = false;
		for (const it of items || []) {
			if (it && it.item_code && it.item_uoms && it.item_uoms.length > 0) {
				cache[it.item_code] = it.item_uoms;
				updated = true;
			}
		}
		if (updated) {
			memory.uom_cache = cache;
			addToPersistQueue("uom_cache", memory.uom_cache);
		}
	} catch (e) {
		console.error("Failed to cache UOMs in bulk", e);
	}
}

export function getItemUOMs(itemCode) {
	try {
		const cache = memory.uom_cache || {};
		return cache[itemCode] || [];
	} catch (e) {
		return [];
	}
}

export function saveOffers(offers) {
	try {
		memory.offers_cache = offers;
		persist("offers_cache", memory.offers_cache);
	} catch (e) {
		console.error("Failed to cache offers", e);
	}
}

export function getCachedOffers() {
	try {
		return memory.offers_cache || [];
	} catch (e) {
		return [];
	}
}

// Price list items caching functions
export function savePriceListItems(priceList, items, persistToDb = true) {
	try {
		const cache = memory.price_list_cache || {};

		// Avoid deep JSON parse/stringify of thousands of items on the main thread.
		// A shallow copy of item array is sufficient and lightning fast.
		const cleanItems = Array.isArray(items) ? items.slice() : [];

		cache[priceList] = {
			items: cleanItems,
			timestamp: Date.now(),
		};
		memory.price_list_cache = cache;
		if (persistToDb) {
			persist("price_list_cache", memory.price_list_cache);
		}
	} catch (e) {
		console.error("Failed to cache price list items", e);
	}
}

export function getCachedPriceListItems(priceList) {
	try {
		const cache = memory.price_list_cache || {};
		const cachedData = cache[priceList];
		if (cachedData) {
			const isValid = Date.now() - cachedData.timestamp < 24 * 60 * 60 * 1000;
			return isValid ? cachedData.items : null;
		}
		return null;
	} catch (e) {
		console.error("Failed to get cached price list items", e);
		return null;
	}
}

export function clearPriceListCache() {
	try {
		memory.price_list_cache = {};
		persist("price_list_cache", memory.price_list_cache);
	} catch (e) {
		console.error("Failed to clear price list cache", e);
	}
}

// Item details caching functions
export function saveItemDetailsCache(profileName, priceList, items) {
	try {
		const cache = memory.item_details_cache || {};
		const profileCache = cache[profileName] || {};
		const priceCache = profileCache[priceList] || {};

		let cleanItems;
		try {
			cleanItems = JSON.parse(JSON.stringify(items));
		} catch (err) {
			console.error("Failed to serialize item details", err);
			cleanItems = [];
		}

		cleanItems.forEach((item) => {
			priceCache[item.item_code] = {
				data: item,
				timestamp: Date.now(),
			};
		});
		profileCache[priceList] = priceCache;
		cache[profileName] = profileCache;
		memory.item_details_cache = cache;
		persist("item_details_cache", memory.item_details_cache);
	} catch (e) {
		console.error("Failed to cache item details", e);
	}
}

export function getCachedItemDetails(profileName, priceList, itemCodes, ttl = 15 * 60 * 1000) {
	try {
		const cache = memory.item_details_cache || {};
		const priceCache = cache[profileName]?.[priceList] || {};
		const now = Date.now();
		const cached = [];
		const missing = [];
		itemCodes.forEach((code) => {
			const entry = priceCache[code];
			if (entry && now - entry.timestamp < ttl) {
				cached.push(entry.data);
			} else {
				missing.push(code);
			}
		});
		return { cached, missing };
	} catch (e) {
		console.error("Failed to get cached item details", e);
		return { cached: [], missing: itemCodes };
	}
}

/**
 * Fetch items modified after the last sync timestamp using get_delta_items API.
 * Avoids redownloading the entire product catalog when only prices, stock, or a few items changed.
 */
export async function refreshModifiedItems(posProfile, priceList, customer) {
	const lastSync = getItemsLastSync();
	if (!lastSync) {
		return { count: 0, items: [] };
	}

	try {
		return await new Promise((resolve) => {
			frappe.call({
				method: "posawesome.posawesome.api.items.get_delta_items",
				args: {
					pos_profile: typeof posProfile === "object" ? JSON.stringify(posProfile) : posProfile,
					price_list: priceList,
					customer: customer || null,
					modified_after: lastSync,
					limit: 1000,
				},
				freeze: false,
				callback: (r) => {
					const fetchedItems = Array.isArray(r?.message) ? r.message : [];
					if (fetchedItems.length > 0) {
						let maxModified = lastSync;
						for (const item of fetchedItems) {
							if (item.modified && item.modified > maxModified) {
								maxModified = item.modified;
							}
						}
						if (maxModified && maxModified !== lastSync) {
							setItemsLastSync(maxModified);
						}
					}
					resolve({ count: fetchedItems.length, items: fetchedItems });
				},
				error: (err) => {
					console.error("Failed to refresh modified items delta:", err);
					resolve({ count: 0, items: [], error: err });
				},
			});
		});
	} catch (error) {
		console.error("Error in refreshModifiedItems:", error);
		return { count: 0, items: [], error };
	}
}

