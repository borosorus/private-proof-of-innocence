import { NetworkName } from '@railgun-community/shared-models';
import { TransactProofData } from '../models/proof-types';
import { ProofMempoolCountingBloomFilter } from './proof-mempool-bloom-filters';
import { CountingBloomFilter } from 'bloom-filters';

export class TransactProofMempoolCache {
  // { listKey: {networkName: {firstBlindedCommitment: TransactProofData} } }
  private static transactProofMempoolCache: Record<
    string,
    Partial<Record<NetworkName, Map<string, TransactProofData>>>
  > = {};

  private static bloomFilters: Partial<
    Record<NetworkName, CountingBloomFilter>
  > = {};

  static getTransactProofs(
    listKey: string,
    networkName: NetworkName,
  ): TransactProofData[] {
    const cache = TransactProofMempoolCache.getCacheForNetworkAndList(
      listKey,
      networkName,
    );
    return Array.from(cache.values());
  }

  private static getCacheForNetworkAndList(
    listKey: string,
    networkName: NetworkName,
  ) {
    TransactProofMempoolCache.transactProofMempoolCache[listKey] ??= {};
    const cacheForList = TransactProofMempoolCache.transactProofMempoolCache[
      listKey
    ] as Record<string, Map<string, TransactProofData>>;
    cacheForList[networkName] ??= new Map();
    return cacheForList[networkName];
  }

  static addToCache(
    listKey: string,
    networkName: NetworkName,
    transactProofData: TransactProofData,
  ) {
    const cache = TransactProofMempoolCache.getCacheForNetworkAndList(
      listKey,
      networkName,
    );

    const firstBlindedCommitment =
      transactProofData.blindedCommitmentOutputs[0];
    cache.set(firstBlindedCommitment, transactProofData);

    TransactProofMempoolCache.addToBloomFilter(
      networkName,
      firstBlindedCommitment,
    );
  }

  static removeFromCache(
    listKey: string,
    networkName: NetworkName,
    firstBlindedCommitment: string,
  ) {
    const cache = TransactProofMempoolCache.getCacheForNetworkAndList(
      listKey,
      networkName,
    );
    cache.delete(firstBlindedCommitment);

    TransactProofMempoolCache.removeFromBloomFilter(
      networkName,
      firstBlindedCommitment,
    );
  }

  private static getBloomFilter(networkName: NetworkName): CountingBloomFilter {
    TransactProofMempoolCache.bloomFilters[networkName] ??=
      ProofMempoolCountingBloomFilter.create();
    return TransactProofMempoolCache.bloomFilters[
      networkName
    ] as CountingBloomFilter;
  }

  private static addToBloomFilter(
    networkName: NetworkName,
    firstBlindedCommitment: string,
  ) {
    TransactProofMempoolCache.getBloomFilter(networkName).add(
      firstBlindedCommitment,
    );
  }

  private static removeFromBloomFilter(
    networkName: NetworkName,
    firstBlindedCommitment: string,
  ) {
    TransactProofMempoolCache.getBloomFilter(networkName).remove(
      firstBlindedCommitment,
    );
  }

  static serializeBloomFilter(networkName: NetworkName): string {
    return ProofMempoolCountingBloomFilter.serialize(
      TransactProofMempoolCache.getBloomFilter(networkName),
    );
  }

  static clearCache_FOR_TEST_ONLY() {
    TransactProofMempoolCache.transactProofMempoolCache = {};
    TransactProofMempoolCache.bloomFilters = {};
  }
}
