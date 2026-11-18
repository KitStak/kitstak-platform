/** Sibling app readers (server only, fail soft). */
export {
  integrationAvailability,
  tableExists,
  wmsSchemaFor,
  wmsTableExists,
  wmsTenantSchemaFor,
  type IntegrationAvailability,
} from './detect';
export { crmReady, getAccounts, getDeals, listWonDeals, searchDeals, type CrmAccount, type CrmDeal } from './crm';
export { listBilledRevenue, listContractPrices, listVasRecords, listWorkOrders, wmsReady, workOrderBuildsByDay, type WmsBilledLine, type WmsBuildDay, type WmsContractPrice, type WmsVasRecord, type WmsWorkOrder } from './wms';
export { getProjects, projectTimeByDay, projectsReady, searchProjects, type PmProject, type PmTimeDay } from './projects';
export { resolveRecords, searchRecords, type RecordTarget } from './records';
