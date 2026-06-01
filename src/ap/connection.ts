// Transport layer: owns the archipelago.js Client and the connection lifecycle,
// nothing game-specific. The provider supplies event handlers via connect(); the
// hook binds socket listeners ONCE per client and dispatches through a ref to the
// latest handlers (so reconnects don't re-register listeners or fire stale ones).
//
// Carries forward the three Pokepelago reconnect fixes:
//   BUG-006  orphan guard — `clientRef.current !== client` short-circuits events
//            from a superseded client so it can't clobber fresh state.
//   BUG-007  ping/reconnect race — never disconnect the old client BEFORE the new
//            one authenticates (the server rejects a too-fast reconnect); drop the
//            old client only after login resolves.
//   BUG-011  identity-scoped state — `connect` rebinds per call and the rebuild
//            reads team/slot from the live client, so a reconnect to a different
//            slot can't read another profile's data (see datastorage.ts keying).

import { useCallback, useRef, useState } from 'react';
import { Client, itemsHandlingFlags, type Item } from 'archipelago.js';
import type { SlotData } from '../game/types';

export interface ConnectionInfo {
  hostname: string;
  port: number;
  slotName: string;
  password?: string;
}

export interface ConnectionHandlers {
  /** Source-of-truth boot: rebuild ALL game state from the server (ADR-0002). */
  onConnected: (client: Client, slotData: SlotData) => void | Promise<void>;
  onDisconnected: () => void;
  /** Live item stream after connect; recompute progression from the full replay. */
  onItemsReceived: (client: Client) => void;
  /** Live location stream; reconcile caughtCount (own checks + remote). */
  onLocationsChecked?: (client: Client) => void;
}

export interface APConnection {
  clientRef: React.MutableRefObject<Client | null>;
  isConnected: boolean;
  connectionError: string | null;
  connect: (info: ConnectionInfo, handlers: ConnectionHandlers) => Promise<void>;
  disconnect: () => void;
}

export function useAPConnection(): APConnection {
  const clientRef = useRef<Client | null>(null);
  const handlersRef = useRef<ConnectionHandlers | null>(null);
  const isConnectingRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const connect = useCallback(async (info: ConnectionInfo, handlers: ConnectionHandlers) => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setConnectionError(null);
    handlersRef.current = handlers;

    const oldClient = clientRef.current;
    const client = new Client();
    clientRef.current = client;

    // Bound once for this client; every listener guards against being orphaned
    // by a later connect() (BUG-006) and dispatches through the latest handlers.
    client.socket.on('connected', () => {
      if (clientRef.current !== client) return;
      setIsConnected(true);
    });
    client.socket.on('disconnected', () => {
      if (clientRef.current !== client) return;
      setIsConnected(false);
      handlersRef.current?.onDisconnected();
    });
    client.items.on('itemsReceived', () => {
      if (clientRef.current !== client) return;
      handlersRef.current?.onItemsReceived(client);
    });
    client.room.on('locationsChecked', () => {
      if (clientRef.current !== client) return;
      handlersRef.current?.onLocationsChecked?.(client);
    });

    const url = `${info.hostname}:${info.port}`;
    try {
      // archipelago.js constrains the generic to its JSONRecord (index-signature)
      // shape; our SlotData is a precise struct, so cast rather than loosen it.
      const slotData = (await client.login(url, info.slotName, 'Digipelago', {
        password: info.password ?? '',
        items: itemsHandlingFlags.all,
      })) as unknown as SlotData;
      // Only now is it safe to drop the previous connection (BUG-007).
      if (oldClient && oldClient !== client) oldClient.socket.disconnect();
      await handlersRef.current?.onConnected(client, slotData);
    } catch (e) {
      if (clientRef.current === client) {
        clientRef.current = oldClient; // restore; a failed attempt must not orphan a live conn
        setConnectionError(e instanceof Error ? e.message : String(e));
      }
      client.socket.disconnect();
      throw e;
    } finally {
      isConnectingRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null; // orphan first: async events from this client now no-op (BUG-006)
    setIsConnected(false);
    client?.socket.disconnect();
  }, []);

  return { clientRef, isConnected, connectionError, connect, disconnect };
}

export type { Item };
