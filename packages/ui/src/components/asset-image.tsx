'use client';
import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { Skeleton } from './feedback';
export interface AssetImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'width' | 'height' | 'alt' | 'src'
> {
  alt: string;
  src?: string;
  width: number;
  height: number;
  fallback?: ReactNode;
}
/** The references contain vectors only; this opt-in primitive reserves a slot for future media. */
export function AssetImage(props: AssetImageProps) {
  return <ImageSlot key={props.src ?? 'missing'} {...props} />;
}
function ImageSlot({
  src,
  alt,
  width,
  height,
  fallback,
  onLoad,
  onError,
  className = '',
  style,
  ...props
}: AssetImageProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(
    src ? 'loading' : 'error',
  );
  return (
    <div
      className={`db-media ${className}`}
      style={{ aspectRatio: `${width} / ${height}`, maxWidth: width, ...style }}
    >
      {state === 'error' ? (
        <div className="db-media-fallback" role="img" aria-label={alt}>
          {fallback ?? 'Image unavailable'}
        </div>
      ) : (
        <>
          <img
            {...props}
            src={src}
            alt={alt}
            width={width}
            height={height}
            style={{ opacity: state === 'ready' ? 1 : 0 }}
            onLoad={(event) => {
              setState('ready');
              onLoad?.(event);
            }}
            onError={(event) => {
              setState('error');
              onError?.(event);
            }}
          />
          {state === 'loading' && (
            <div className="db-media-loading" role="status">
              <span className="db-sr-only">Loading image…</span>
              <Skeleton width="100%" height="100%" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
