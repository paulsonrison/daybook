import { agencyRead, type RequestContext } from '../context.js';
import { readDeliveryMetrics } from './metrics-repository.js';
export const deliveryMetrics = (ctx: RequestContext) =>
  agencyRead(ctx, readDeliveryMetrics);
