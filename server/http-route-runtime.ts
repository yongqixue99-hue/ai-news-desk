import type { readState, readStateProjection, updateState, replaceState, getLocalDatabase } from "./storage.js";
import type { createDeliveryDesk } from "./delivery-desk.js";
import type { createZhihuHotlist } from "./source-desk.js";
import type { createWeChatDelivery } from "./wechat-delivery.js";
import type { createPortableArchiveImportConfirmationDesk } from "./portable-archive-import-confirmation.js";
import type { createTodayTitleBackfill } from "./today-title-backfill.js";
import type { createXiaoheiheDelivery } from "./xiaoheihe-delivery.js";

/** Lazy getters preserve the composition root service initialization order. */
export interface HttpRouteRuntime {
  readonly readState: typeof readState;
  readonly readStateProjection: typeof readStateProjection;
  readonly updateState: typeof updateState;
  readonly replaceState: typeof replaceState;
  readonly getLocalDatabase: typeof getLocalDatabase;
  readonly deliveryDesk: ReturnType<typeof createDeliveryDesk>;
  readonly zhihuHotlist: ReturnType<typeof createZhihuHotlist>;
  readonly wechatDelivery: ReturnType<typeof createWeChatDelivery>;
  readonly portableArchiveImportConfirmations: ReturnType<typeof createPortableArchiveImportConfirmationDesk>;
  readonly backfillTodayTitles: ReturnType<typeof createTodayTitleBackfill>;
  readonly xiaoheiheDelivery: ReturnType<typeof createXiaoheiheDelivery>;
}
