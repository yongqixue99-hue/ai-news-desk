import { deliveryPlatforms, type DeliveryPlatform } from "../server/delivery-batch-types.js";

const preferenceKey = "newsdesk.social-platforms.v1";
export const readDeliverySelection = (storage?: Pick<Storage, "getItem">): DeliveryPlatform[] => {
  try {
    const value: unknown = JSON.parse((storage ?? window.localStorage).getItem(preferenceKey) || "null");
    if (Array.isArray(value)) return deliveryPlatforms.filter(platform => value.includes(platform.id)).map(platform => platform.id);
  } catch { /* Storage is optional; never choose a destination on the user's behalf. */ }
  return [];
};
export const rememberDeliverySelection = (storage: Pick<Storage, "setItem"> | undefined, selected: readonly DeliveryPlatform[]) => {
  try { (storage ?? window.localStorage).setItem(preferenceKey, JSON.stringify(selected)); } catch { /* Optional preference. */ }
};
