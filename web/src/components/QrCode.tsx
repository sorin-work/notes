import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * A QR code drawn as SVG paths, black on white whatever the theme, since
 * phone cameras read dark modules on a light ground. Nothing is put into
 * the page as markup: the squares come from the library, the drawing from
 * here.
 */
export function QrCode({ text, label, size = 192 }: { text: string; label: string; size?: number }) {
  const { count, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    const modules = code.getModuleCount();
    let d = '';
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { count: modules, path: d };
  }, [text]);
  const side = count + 8;
  return (
    <svg
      className="qr-code"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
