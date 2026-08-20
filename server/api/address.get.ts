import { describeAddress } from '~~/server/lib/address-view'

export default defineEventHandler(async () => guard(() => describeAddress()))
