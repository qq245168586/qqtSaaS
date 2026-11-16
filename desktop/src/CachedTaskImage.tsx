import { useEffect, useState } from 'react';
import { Image, Button } from 'antd';
import { z } from 'zod';
import { ipc } from './api';
export function CachedTaskImage({
  taskId,
  id,
  size = 70,
  hidden = false,
}: {
  taskId: string;
  id: string;
  size?: number;
  hidden?: boolean;
}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let url = '';
    setError(false);
    void ipc(
      window.desktop.image({ taskId, id }),
      z.object({ bytes: z.instanceof(Uint8Array), type: z.string() }),
    )
      .then((data) => {
        if (!active) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(data.bytes)], { type: data.type }));
        setSrc(url);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [taskId, id, revision]);
  if (error)
    return (
      <Button size="small" onClick={() => setRevision((v) => v + 1)}>
        重试图片
      </Button>
    );
  return (
    <Image
      width={size}
      height={size}
      style={{ objectFit: 'cover', display: hidden ? 'none' : undefined }}
      src={src || undefined}
    />
  );
}
