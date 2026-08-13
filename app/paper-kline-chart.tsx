"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { initialPaperKlineWindow, mapPaperTradesToBars } from "./paper-kline-model";
import type { PaperAccountView } from "./paper-account-types";
import type { Kline } from "./strategy-engine";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" });
const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const maDefinitions = [
  { period: 5, label: "MA5", color: "#f4c95d" },
  { period: 10, label: "MA10", color: "#55c8ff" },
  { period: 30, label: "MA30", color: "#b38cff" },
];

function movingAverageSeries(bars: Kline[], period: number) {
  let sum = 0;
  return bars.map((bar, index) => {
    sum += bar.close;
    if (index >= period) sum -= bars[index - period].close;
    return index + 1 >= period ? sum / period : null;
  });
}

export function PaperKlineChart({ account }: { account: PaperAccountView }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; moved: boolean } | null>(null);
  const [bars, setBars] = useState<Kline[]>([]);
  const [trades, setTrades] = useState(account.trades);
  const [firstBuyTradeId, setFirstBuyTradeId] = useState(account.firstBuyTrade?.id ?? null);
  const [visibleCount, setVisibleCount] = useState(120);
  const [endOffset, setEndOffset] = useState(0);
  const [hover, setHover] = useState<{ index: number; x: number; alignLeft: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/tickflow?symbols=${encodeURIComponent(account.symbol)}&count=10000`, { signal: controller.signal }),
      fetch(`/api/paper-accounts?id=${encodeURIComponent(account.id)}`, { signal: controller.signal }),
    ]).then(async ([klineResponse, detailResponse]) => {
      const klinePayload = await klineResponse.json() as { data?: Record<string, Kline[]>; error?: string };
      const detailPayload = await detailResponse.json() as { accounts?: PaperAccountView[]; error?: string };
      if (!klineResponse.ok) throw new Error(klinePayload.error || "读取日K失败");
      const nextBars = klinePayload.data?.[account.symbol] ?? [];
      if (!nextBars.length) throw new Error("没有可用日K数据");
      const detail = detailResponse.ok ? detailPayload.accounts?.[0] : null;
      const firstBuy = detail?.firstBuyTrade ?? account.firstBuyTrade;
      const detailTrades = detail?.trades ?? account.trades;
      const nextTrades = firstBuy && !detailTrades.some((trade) => trade.id === firstBuy.id) ? [...detailTrades, firstBuy] : detailTrades;
      const nextMarkers = mapPaperTradesToBars(nextBars, nextTrades, firstBuy?.id ?? null);
      const initialWindow = initialPaperKlineWindow(nextBars.length, nextMarkers.map((marker) => marker.index));
      setError("");
      setBars(nextBars); setTrades(nextTrades); setFirstBuyTradeId(firstBuy?.id ?? null);
      setVisibleCount(initialWindow.visibleCount); setEndOffset(initialWindow.endOffset);
    }).catch((caught) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "读取模拟盘日K失败");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account.firstBuyTrade, account.id, account.symbol, account.trades]);

  const markers = useMemo(() => mapPaperTradesToBars(bars, trades, firstBuyTradeId), [bars, firstBuyTradeId, trades]);
  const maValues = useMemo(() => new Map(maDefinitions.map((definition) => [definition.period, movingAverageSeries(bars, definition.period)])), [bars]);
  const safeVisibleCount = Math.min(Math.max(1, visibleCount), Math.max(1, bars.length));
  const maxEndOffset = Math.max(0, bars.length - safeVisibleCount);
  const safeEndOffset = Math.min(endOffset, maxEndOffset);
  const visibleEnd = Math.max(0, bars.length - safeEndOffset);
  const visibleStart = Math.max(0, visibleEnd - safeVisibleCount);
  const visibleBars = useMemo(() => bars.slice(visibleStart, visibleEnd), [bars, visibleEnd, visibleStart]);
  const visibleMarkers = useMemo(() => markers.filter((marker) => marker.index >= visibleStart && marker.index < visibleEnd), [markers, visibleEnd, visibleStart]);
  const firstBuyIndex = markers.find((marker) => marker.firstBuy)?.index ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const draw = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
      if (!visibleBars.length) {
        ctx.fillStyle = "#687991"; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText(loading ? "正在读取 TickFlow 日K…" : error || "暂无日K数据", rect.width / 2, rect.height / 2);
        return;
      }
      const pad = { top: 26, right: 16, bottom: 28, left: rect.width < 430 ? 48 : 54 };
      const chartWidth = Math.max(1, rect.width - pad.left - pad.right);
      const chartHeight = Math.max(1, rect.height - pad.top - pad.bottom);
      const maPrices = maDefinitions.flatMap((definition) => (maValues.get(definition.period) ?? []).slice(visibleStart, visibleEnd).filter((value): value is number => value != null));
      const prices = [...visibleBars.flatMap((bar) => [bar.low, bar.high]), ...maPrices, ...visibleMarkers.map((marker) => marker.executionPrice)];
      const rawMinimum = Math.min(...prices); const rawMaximum = Math.max(...prices);
      const spread = Math.max(rawMaximum * .01, rawMaximum - rawMinimum, .01);
      const minimum = rawMinimum - spread * .1; const maximum = rawMaximum + spread * .1;
      const slot = chartWidth / visibleBars.length;
      const xFor = (localIndex: number) => pad.left + (localIndex + .5) * slot;
      const yFor = (value: number) => pad.top + (1 - (value - minimum) / (maximum - minimum)) * chartHeight;

      ctx.font = "9px ui-monospace, SFMono-Regular, monospace";
      for (let tick = 0; tick <= 4; tick += 1) {
        const y = pad.top + chartHeight / 4 * tick;
        const value = maximum - (maximum - minimum) / 4 * tick;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(rect.width - pad.right, y); ctx.strokeStyle = "rgba(126,143,172,.13)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#62708a"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(value.toFixed(2), pad.left - 7, y);
      }
      ctx.fillStyle = "#73829a"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText("元", 7, pad.top - 8);
      for (let tick = 0; tick <= 6; tick += 1) {
        const x = pad.left + chartWidth / 6 * tick;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, rect.height - pad.bottom); ctx.strokeStyle = "rgba(126,143,172,.07)"; ctx.stroke();
      }

      const candleWidth = Math.max(1, Math.min(11, slot * .66));
      visibleBars.forEach((bar, localIndex) => {
        const x = xFor(localIndex); const up = bar.close >= bar.open; const color = up ? "#ff5b6e" : "#37d6aa";
        const openY = yFor(bar.open); const closeY = yFor(bar.close);
        ctx.beginPath(); ctx.moveTo(x, yFor(bar.high)); ctx.lineTo(x, yFor(bar.low)); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, Math.min(1.5, candleWidth / 5)); ctx.stroke();
        ctx.fillStyle = up ? `${color}dd` : `${color}c2`; ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(1, Math.abs(closeY - openY)));
      });

      maDefinitions.forEach((definition) => {
        const values = maValues.get(definition.period) ?? [];
        ctx.beginPath(); let started = false;
        for (let index = visibleStart; index < visibleEnd; index += 1) {
          const value = values[index]; if (value == null) { started = false; continue; }
          const x = xFor(index - visibleStart); const y = yFor(value);
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
        ctx.strokeStyle = definition.color; ctx.lineWidth = 1.25; ctx.lineJoin = "round"; ctx.stroke();
      });

      const markerStacks = new Map<string, number>();
      visibleMarkers.forEach((marker) => {
        const localIndex = marker.index - visibleStart; const bar = bars[marker.index]; const x = xFor(localIndex);
        const isBuy = marker.action === "buy"; const color = isBuy ? "#ff5b6e" : "#37d6aa";
        const stackKey = `${marker.index}:${marker.action}`; const stack = markerStacks.get(stackKey) ?? 0; markerStacks.set(stackKey, stack + 1);
        const priceY = yFor(marker.executionPrice);
        const iconY = Math.max(pad.top + 10, Math.min(rect.height - pad.bottom - 10, yFor(isBuy ? bar.low : bar.high) + (isBuy ? 20 + stack * 18 : -20 - stack * 18)));
        ctx.beginPath(); ctx.moveTo(x, priceY); ctx.lineTo(x, iconY); ctx.strokeStyle = `${color}a0`; ctx.lineWidth = 1; ctx.stroke();
        if (marker.firstBuy) {
          const labelWidth = 44; const labelHeight = 17;
          ctx.beginPath(); ctx.roundRect(x - labelWidth / 2, iconY - labelHeight / 2, labelWidth, labelHeight, 7);
          ctx.fillStyle = "#f4c95d"; ctx.fill(); ctx.strokeStyle = "rgba(255,238,174,.85)"; ctx.stroke();
          ctx.fillStyle = "#191406"; ctx.font = "bold 8px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("首买 B", x, iconY + .5);
        } else {
          ctx.beginPath(); ctx.arc(x, iconY, 8, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
          ctx.fillStyle = "#071018"; ctx.font = "bold 8px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(isBuy ? "B" : "S", x, iconY + .5);
        }
      });

      if (hover && hover.index >= visibleStart && hover.index < visibleEnd) {
        const bar = bars[hover.index]; const x = xFor(hover.index - visibleStart); const y = yFor(bar.close);
        ctx.save(); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, rect.height - pad.bottom); ctx.moveTo(pad.left, y); ctx.lineTo(rect.width - pad.right, y); ctx.strokeStyle = "rgba(174,193,222,.5)"; ctx.stroke(); ctx.restore();
      }

      const labelIndexes = [...new Set([0, .25, .5, .75, 1].map((ratio) => Math.min(visibleBars.length - 1, Math.round((visibleBars.length - 1) * ratio))))];
      ctx.fillStyle = "#62708a"; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      labelIndexes.forEach((index) => ctx.fillText(dateFormatter.format(visibleBars[index].timestamp), xFor(index), rect.height - 7));
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(parent); return () => observer.disconnect();
  }, [bars, error, hover, loading, maValues, visibleBars, visibleEnd, visibleMarkers, visibleStart]);

  const hoverFor = (index: number, width: number) => {
    const x = 54 + (index - visibleStart + .5) / Math.max(1, safeVisibleCount) * Math.max(1, width - 70);
    return { index, x, alignLeft: x > width * .62 };
  };
  const indexFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!visibleBars.length) return null;
    const left = rect.width < 430 ? 48 : 54; const local = Math.floor((event.clientX - rect.left - left) / Math.max(1, rect.width - left - 16) * visibleBars.length);
    const index = visibleStart + Math.max(0, Math.min(visibleBars.length - 1, local));
    return hoverFor(index, rect.width);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: safeEndOffset, moved: false }; setHover(indexFromPointer(event));
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId && Math.abs(event.clientX - drag.startX) > 3) {
      drag.moved = true; setDragging(true);
      const width = Math.max(1, event.currentTarget.getBoundingClientRect().width - 70);
      const delta = Math.round((event.clientX - drag.startX) / Math.max(2, width / safeVisibleCount));
      setEndOffset(Math.max(0, Math.min(maxEndOffset, drag.startOffset + delta))); setHover(null); return;
    }
    setHover(indexFromPointer(event));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const applyZoom = (nextCount: number) => {
    if (!bars.length) return;
    const next = Math.max(Math.min(30, bars.length), Math.min(bars.length, Math.round(nextCount)));
    const anchor = hover?.index ?? Math.floor((visibleStart + visibleEnd) / 2);
    const start = Math.max(0, Math.min(bars.length - next, anchor - Math.floor(next / 2)));
    setVisibleCount(next); setEndOffset(Math.max(0, bars.length - start - next)); setHover(null);
  };
  const focusFirstBuy = () => {
    if (firstBuyIndex == null || !bars.length) return;
    const next = Math.min(120, bars.length); const start = Math.max(0, Math.min(bars.length - next, firstBuyIndex - Math.floor(next * .3)));
    setVisibleCount(next); setEndOffset(Math.max(0, bars.length - start - next)); setHover(null);
  };
  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => { event.preventDefault(); applyZoom(safeVisibleCount * (event.deltaY > 0 ? 1.18 : .84)); };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault(); const direction = event.key === "ArrowRight" ? 1 : -1; const width = event.currentTarget.getBoundingClientRect().width;
    setHover((current) => hoverFor(Math.max(visibleStart, Math.min(visibleEnd - 1, (current?.index ?? visibleEnd - 1) + direction)), width));
  };
  const activeBar = hover ? bars[hover.index] : null;
  const activeTrades = hover ? markers.filter((marker) => marker.index === hover.index) : [];
  const maxStart = Math.max(0, bars.length - safeVisibleCount);

  return <section className="paper-kline-card">
    <header><div><span>TICKFLOW DAILY KLINE</span><b>{account.stockName}日K与模拟成交</b></div><div className="paper-kline-legend"><em className="paper-candle-up" />上涨<em className="paper-candle-down" />下跌<i className="paper-buy-dot">B</i>买入<i className="paper-sell-dot">S</i>卖出<strong>首买 B</strong></div></header>
    <div className="paper-kline-toolbar"><div>{maDefinitions.map((definition) => <span key={definition.period} style={{ color: definition.color }}><i style={{ background: definition.color }} />{definition.label}</span>)}</div><div><button disabled={safeVisibleCount >= bars.length} onClick={() => applyZoom(safeVisibleCount * 1.25)}>−</button><button disabled={safeVisibleCount <= Math.min(30, bars.length)} onClick={() => applyZoom(safeVisibleCount * .8)}>＋</button><button disabled={firstBuyIndex == null} onClick={focusFirstBuy}>首买</button><button onClick={() => { setEndOffset(0); setHover(null); }}>最新</button></div></div>
    <div className={`paper-kline-stage ${dragging ? "dragging" : ""}`}>
      <canvas ref={canvasRef} tabIndex={0} aria-label={`${account.stockName}日K蜡烛图，包含模拟买卖点和第一次买入标记；可拖动、滚轮缩放或使用左右方向键查看`} onBlur={() => setHover(null)} onFocus={(event) => { if (visibleBars.length) setHover(hoverFor(visibleEnd - 1, event.currentTarget.getBoundingClientRect().width)); }} onKeyDown={onKeyDown} onPointerCancel={onPointerUp} onPointerDown={onPointerDown} onPointerLeave={() => { if (!dragRef.current) setHover(null); }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel} />
      {activeBar && hover && <div className={`paper-kline-tooltip ${hover.alignLeft ? "align-left" : ""}`} style={{ left: hover.x }} role="status"><time>{fullDateFormatter.format(activeBar.timestamp)}</time><b>开 {activeBar.open.toFixed(2)} / 高 {activeBar.high.toFixed(2)} / 低 {activeBar.low.toFixed(2)} / 收 {activeBar.close.toFixed(2)}</b>{activeTrades.map((trade) => <span className={trade.action} key={trade.id}>{trade.firstBuy ? "首买" : trade.action === "buy" ? "买入" : "卖出"} {trade.shares.toLocaleString("zh-CN")} 股 · ¥{trade.executionPrice.toFixed(3)}</span>)}</div>}
    </div>
    <div className="paper-kline-navigator"><span>{visibleBars[0] ? fullDateFormatter.format(visibleBars[0].timestamp) : "—"}</span><input type="range" min="0" max={maxStart} value={Math.min(visibleStart, maxStart)} disabled={!maxStart} aria-label="拖动浏览模拟盘历史K线" onChange={(event) => setEndOffset(Math.max(0, bars.length - Number(event.target.value) - safeVisibleCount))} /><span>{visibleBars.at(-1) ? fullDateFormatter.format(visibleBars.at(-1)!.timestamp) : "—"}</span><small>{markers.length ? `${markers.length} 个成交点` : "暂无成交点"}</small></div>
    {error && <p>{error}</p>}
  </section>;
}
