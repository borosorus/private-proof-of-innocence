import debug from 'debug';
import { startEngine, stopEngine } from '../engine/engine-init';
import { initNetworkProviders } from '../rpc-providers/active-network-providers';
import { setOnMerkletreeScanCallback } from '@railgun-community/wallet';
import { onMerkletreeScanCallback } from '../status/merkletree-scan-callback';
import { DatabaseClient } from '../database/database-client-init';
import { TransactProofMempool } from '../proof-mempool/transact-proof-mempool';
import { POIMerkletreeManager } from '../poi-events/poi-merkletree-manager';
import { BlockedShieldsSyncer } from '../shields/blocked-shields-syncer';

const dbg = debug('poi:init');

export const initModules = async (listKeys: string[]) => {
  // Init engine and RPCs
  dbg('Initializing Engine and RPCs...');
  startEngine();
  await initNetworkProviders();
  setOnMerkletreeScanCallback(onMerkletreeScanCallback);

  dbg('Setting up databases...');
  await DatabaseClient.init();
  await DatabaseClient.ensureDBIndicesAllChains();

  dbg('Inflating Transact Proof mempool cache...');
  await TransactProofMempool.inflateCacheFromDatabase(listKeys);

  dbg('Inflating Blocked Shields cache...');
  await BlockedShieldsSyncer.inflateCacheFromDatabase(listKeys);

  dbg('Generating POI Merkletrees for each list and network...');
  POIMerkletreeManager.initListMerkletrees(listKeys);

  dbg('Node init successful.');
};

export const uninitModules = async () => {
  await stopEngine();
};
