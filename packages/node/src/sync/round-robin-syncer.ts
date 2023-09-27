import {
  NetworkName,
  delay,
  isDefined,
  NodeStatusAllNetworks,
} from '@railgun-community/shared-models';
import debug from 'debug';
import { Config } from '../config/config';
import { POINodeRequest } from '../api/poi-node-request';
import { RailgunTxidMerkletreeManager } from '../railgun-txids/railgun-txid-merkletree-manager';
import { POIEventList } from '../poi-events/poi-event-list';
import { QueryLimits } from '../config/query-limits';
import { TransactProofMempool } from '../proof-mempool/transact-proof-mempool';
import { NodeConfig, PollStatus } from '../models/general-types';
import { TransactProofMempoolCache } from '../proof-mempool/transact-proof-mempool-cache';
import { BlockedShieldsCache } from '../shields/blocked-shields-cache';
import { BlockedShieldsSyncer } from '../shields/blocked-shields-syncer';
import { getListKeysFromNodeConfigs } from '../config/general';

const dbg = debug('poi:sync');

export class RoundRobinSyncer {
  private readonly nodeConfigs: NodeConfig[] = [];

  private currentNodeIndex = 0;

  private pollStatus = PollStatus.IDLE;

  private listKeys: string[];

  constructor(nodeConfigs: NodeConfig[]) {
    this.nodeConfigs = nodeConfigs;
    this.listKeys = getListKeysFromNodeConfigs(nodeConfigs);
  }

  getPollStatus(): PollStatus {
    return this.pollStatus;
  }

  startPolling() {
    if (this.nodeConfigs.length === 0) {
      dbg('No connected nodes - not polling.');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.poll();
  }

  private async poll() {
    const { nodeURL } = this.nodeConfigs[this.currentNodeIndex];

    try {
      const nodeStatusAllNetworks =
        await POINodeRequest.getNodeStatusAllNetworks(nodeURL);

      await this.updatePOIEventListAllNetworks(nodeURL, nodeStatusAllNetworks);
      dbg('Synced: POI Event Lists');

      await this.updateTransactProofMempoolsAllNetworks(
        nodeURL,
        nodeStatusAllNetworks,
      );
      dbg('Synced: Transact Proof Mempools');

      await this.updateRailgunTxidMerkletreeValidatedRootAllNetworks(
        nodeURL,
        nodeStatusAllNetworks,
      );
      dbg('Synced: Railgun Validated TXID Merkletree Roots');

      await this.updateBlockedShieldsAllNetworks(
        nodeURL,
        nodeStatusAllNetworks,
      );
      dbg('Synced: Blocked Shields');

      this.pollStatus = PollStatus.POLLING;

      // 30 second delay before next poll
      await delay(30 * 1000);
    } catch (err) {
      dbg(`Error polling node ${nodeURL}: ${err.message}`);

      this.pollStatus = PollStatus.ERROR;

      // 5 second delay before next poll
      await delay(5 * 1000);
    } finally {
      this.incrementNodeIndex();

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.poll();
    }
  }

  private async updateRailgunTxidMerkletreeValidatedRootAllNetworks(
    nodeURL: string,
    nodeStatusAllNetworks: NodeStatusAllNetworks,
  ) {
    await Promise.all(
      Config.NETWORK_NAMES.map(async networkName => {
        const nodeStatus = nodeStatusAllNetworks.forNetwork[networkName];
        if (!nodeStatus) {
          dbg(`Node ${nodeURL} does not support network ${networkName}`);
          return;
        }
        await RailgunTxidMerkletreeManager.updateValidatedRailgunTxidStatusSafe(
          nodeURL,
          networkName,
          nodeStatus.txidStatus,
        );
      }),
    );
  }

  async updatePOIEventListAllNetworks(
    nodeURL: string,
    nodeStatusAllNetworks: NodeStatusAllNetworks,
  ) {
    for (const networkName of Config.NETWORK_NAMES) {
      const nodeStatus = nodeStatusAllNetworks.forNetwork[networkName];
      if (!nodeStatus) {
        continue;
      }
      const { listStatuses } = nodeStatus;

      for (const listKey of this.listKeys) {
        if (!isDefined(listStatuses[listKey])) {
          continue;
        }
        await this.updatePOIEventList(
          nodeURL,
          networkName,
          listKey,
          listStatuses[listKey].poiEvents,
        );
      }
    }
  }

  private async updatePOIEventList(
    nodeURL: string,
    networkName: NetworkName,
    listKey: string,
    nodePOIEventsLength: number,
  ) {
    const currentListLength = await POIEventList.getPOIEventsLength(
      networkName,
      listKey,
    );
    if (nodePOIEventsLength <= currentListLength) {
      return;
    }

    // Update up to 100 events from this list.
    const startIndex = currentListLength;
    const endIndex = Math.min(
      startIndex + QueryLimits.MAX_EVENT_QUERY_RANGE_LENGTH - 1,
      nodePOIEventsLength - 1,
    );

    const signedPOIEvents = await POINodeRequest.getPOIListEventRange(
      nodeURL,
      networkName,
      listKey,
      startIndex,
      endIndex,
    );

    await POIEventList.verifyAndAddSignedPOIEvents(
      networkName,
      listKey,
      signedPOIEvents,
    );

    dbg(
      `Synced ${signedPOIEvents.length} POI events to list ${listKey} for network ${networkName}`,
    );
  }

  async updateTransactProofMempoolsAllNetworks(
    nodeURL: string,
    nodeStatusAllNetworks: NodeStatusAllNetworks,
  ) {
    for (const networkName of Config.NETWORK_NAMES) {
      const nodeStatus = nodeStatusAllNetworks.forNetwork[networkName];
      if (!nodeStatus) {
        continue;
      }
      const { listStatuses } = nodeStatus;

      for (const listKey of this.listKeys) {
        if (!isDefined(listStatuses[listKey])) {
          continue;
        }
        await this.updateTransactProofMempool(
          nodeURL,
          networkName,
          listKey,
          listStatuses[listKey].pendingTransactProofs,
        );
      }
    }
  }

  private async updateTransactProofMempool(
    nodeURL: string,
    networkName: NetworkName,
    listKey: string,
    nodePendingTransactProofsLength: number,
  ) {
    const currentTransactProofsLength = TransactProofMempoolCache.getCacheSize(
      listKey,
      networkName,
    );
    if (nodePendingTransactProofsLength <= currentTransactProofsLength) {
      return;
    }

    const serializedBloomFilter =
      TransactProofMempoolCache.serializeBloomFilter(listKey, networkName);
    const transactProofs = await POINodeRequest.getFilteredTransactProofs(
      nodeURL,
      networkName,
      listKey,
      serializedBloomFilter,
    );
    for (const transactProof of transactProofs) {
      try {
        await TransactProofMempool.submitProof(
          listKey,
          networkName,
          transactProof,
        );
      } catch (err) {
        dbg(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          `Error submitting transact proof to mempool for list ${listKey} on network ${networkName}: ${err.message}`,
        );
      }
    }
  }

  async updateBlockedShieldsAllNetworks(
    nodeURL: string,
    nodeStatusAllNetworks: NodeStatusAllNetworks,
  ) {
    for (const networkName of Config.NETWORK_NAMES) {
      const nodeStatus = nodeStatusAllNetworks.forNetwork[networkName];
      if (!nodeStatus) {
        continue;
      }
      const { listStatuses } = nodeStatus;

      for (const listKey of this.listKeys) {
        if (!isDefined(listStatuses[listKey])) {
          continue;
        }
        await this.updateBlockedShields(
          nodeURL,
          networkName,
          listKey,
          listStatuses[listKey].blockedShields,
        );
      }
    }
  }

  private async updateBlockedShields(
    nodeURL: string,
    networkName: NetworkName,
    listKey: string,
    nodeBlockedShieldsLength: number,
  ) {
    const currentBlockedShieldsLength = BlockedShieldsCache.getBlockedShields(
      listKey,
      networkName,
    ).length;
    if (nodeBlockedShieldsLength <= currentBlockedShieldsLength) {
      return;
    }

    const serializedBloomFilter = BlockedShieldsCache.serializeBloomFilter(
      listKey,
      networkName,
    );
    const signedBlockedShields = await POINodeRequest.getFilteredBlockedShields(
      nodeURL,
      networkName,
      listKey,
      serializedBloomFilter,
    );
    for (const signedBlockedShield of signedBlockedShields) {
      try {
        await BlockedShieldsSyncer.addSignedBlockedShield(
          listKey,
          networkName,
          signedBlockedShield,
        );
      } catch (err) {
        dbg(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          `Error adding blocked shield for list ${listKey} on network ${networkName}: ${err.message}`,
        );
      }
    }
  }

  private incrementNodeIndex() {
    this.currentNodeIndex += 1;
    this.currentNodeIndex %= this.nodeConfigs.length;
  }
}
