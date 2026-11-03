import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AttachmentPlatform,
  nativeAttachmentPlatform,
  PickResult,
  PickSource,
} from '../../attachments/platform';

export interface AttachmentSession {
  /**
   * Opens a picker and imports what the user picks. The imported files belong
   * to this session until `commit`. Resolves with null if the editor closed
   * meanwhile (the files are then deleted). Rejects with an AttachmentError.
   */
  pick(options: {
    source: PickSource;
    imagesOnly: boolean;
    maxCount: number;
  }): Promise<PickResult | null>;
  /**
   * The draft no longer uses these attachments. Files imported in this
   * session are deleted now; stored ones stay until the save that drops them
   * has committed (ItemsProvider deletes them then).
   */
  release(ids: string[]): void;
  /**
   * Called when saving: the draft keeps `keptIds`. Session files not kept are
   * deleted; the kept ones now belong to the saved item.
   */
  commit(keptIds: string[]): void;
}

/**
 * Files imported while an editor is open. Leaving without saving (Cancel,
 * Discard, back) deletes every one of them at once; a crash leaves them for
 * the startup cleanup, as nothing in the database refers to them.
 */
export function useAttachmentSession(
  platform: AttachmentPlatform = nativeAttachmentPlatform,
): AttachmentSession {
  const owned = useRef(new Set<string>());
  const open = useRef(true);
  const committed = useRef(false);

  const remove = useCallback(
    (ids: string[]) => {
      if (ids.length > 0) {
        platform
          .deleteFiles(ids)
          .catch(() =>
            console.warn('[attachments] could not delete unsaved files'),
          );
      }
    },
    [platform],
  );

  useEffect(() => {
    open.current = true;
    const files = owned.current;
    return () => {
      open.current = false;
      if (!committed.current) {
        remove([...files]);
        files.clear();
      }
    };
  }, [remove]);

  return useMemo(
    () => ({
      async pick(options) {
        const result = await platform.pick(options);
        const ids = result.imported.map(a => a.id);
        if (!open.current || committed.current) {
          remove(ids);
          return null;
        }
        ids.forEach(id => owned.current.add(id));
        return result;
      },
      release(ids) {
        const unsaved = ids.filter(id => owned.current.delete(id));
        remove(unsaved);
      },
      commit(keptIds) {
        committed.current = true;
        const kept = new Set(keptIds);
        remove([...owned.current].filter(id => !kept.has(id)));
        owned.current.clear();
      },
    }),
    [platform, remove],
  );
}
