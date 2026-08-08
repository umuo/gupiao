"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WatchItem = {
  code: string;
  name: string;
  price: number;
  change: number;
  signal: string;
};

type Strategy = {
  id: string;
  name: string;
  summary: string;
  tag: string;
  color: string;
  metrics: {
    total: string;
    annual: string;
    drawdown: string;
    sharpe: string;
    winRate: string;
    trades: string;
    equity: string;
  };
};

const initialWatchlist: WatchItem[] = [
  { code: "600519", name: "贵州茅台", price: 1497.6, change: 1.82, signal: "突破" },
  { code: "300750", name: "宁德时代", price: 268.4, change: -0.76, signal: "观察" },
  { code: "300308", name: "中际旭创", price: 157.2, change: 3.41, signal: "持有" },
  { code: "600036", name: "招商银行", price: 43.18, change: 0.54, signal: "买入" },
  { code: "603259", name: "药明康德", price: 79.21, change: -1.13, signal: "减仓" },
];

const candidates: WatchItem[] = [
  { code: "601318", name: "中国平安", price: 58.42, change: 0.93, signal: "观察" },
  { code: "000858", name: "五粮液", price: 128.66, change: 1.26, signal: "突破" },
  { code: "002594", name: "比亚迪", price: 118.73, change: -0.38, signal: "观察" },
  { code: "688981", name: "中芯国际", price: 92.15, change: 2.18, signal: "持有" },
  { code: "600900", name: "长江电力", price: 29.87, change: 0.27, signal: "买入" },
];

const strategies: Strategy[] = [
  {
    id: "breakout",
    name: "趋势突破",
    summary: "20 日新高 + 成交量放大确认",
    tag: "进取",
    color: "#ff5b6e",
    metrics: { total: "+18.42%", annual: "+31.80%", drawdown: "-8.62%", sharpe: "1.84", winRate: "58.4%", trades: "46", equity: "¥ 1,184,260" },
  },
  {
    id: "ma",
    name: "均线动量",
    summary: "MA5 上穿 MA20 + 强度过滤",
    tag: "均衡",
    color: "#4c8dff",
    metrics: { total: "+14.73%", annual: "+24.60%", drawdown: "-6.31%", sharpe: "1.57", winRate: "55.9%", trades: "34", equity: "¥ 1,147,300" },
  },
  {
    id: "dividend",
    name: "低波红利",
    summary: "低波动率 + 股息质量因子",
    tag: "稳健",
    color: "#37d6aa",
    metrics: { total: "+11.28%", annual: "+18.90%", drawdown: "-3.92%", sharpe: "1.72", winRate: "63.2%", trades: "21", equity: "¥ 1,112,800" },
  },
  {
    id: "rsi",
    name: "RSI 逆转",
    summary: "超卖反弹 + 三日价格确认",
    tag: "短线",
    color: "#b38cff",
    metrics: { total: "+12.91%", annual: "+21.40%", drawdown: "-10.18%", sharpe: "1.21", winRate: "52.7%", trades: "68", equity: "¥ 1,129,100" },
  },
];

const positions = [
  { name: "贵州茅台", code: "600519", shares: "200 股", cost: "1,462.80", price: "1,497.60", pnl: "+6,960.00", rate: "+2.38%" },
  { name: "中际旭创", code: "300308", shares: "800 股", cost: "148.35", price: "157.20", pnl: "+7,080.00", rate: "+5.97%" },
  { name: "招商银行", code: "600036", shares: "2,000 股", cost: "41.96", price: "43.18", pnl: "+2,440.00", rate: "+2.91%" },
];

const activity = [
  { time: "14:42:16", action: "买入", stock: "招商银行", detail: "43.06 × 500", reason: "MA5 上穿 MA20" },
  { time: "13:18:04", action: "卖出", stock: "宁德时代", detail: "269.10 × 300", reason: "触发 8% 移动止盈" },
  { time: "10:06:38", action: "买入", stock: "中际旭创", detail: "155.80 × 200", reason: "放量突破 20 日高点" },
];

const equitySeries: Record<string, number[]> = {
  breakout: [0, 1, 0.5, 2, 1.8, 3.4, 4.1, 3.6, 5.9, 7.3, 6.7, 9.2, 8.4, 10.9, 12.7, 11.8, 14.6, 13.9, 16.4, 18.42],
  ma: [0, 0.6, 0.2, 1.5, 2.4, 2.1, 3.8, 4.6, 4.1, 6.2, 7.8, 7.1, 8.7, 9.8, 9.4, 11.2, 10.7, 12.8, 13.6, 14.73],
  dividend: [0, 0.3, 0.8, 1.1, 1.7, 2.2, 2.6, 2.4, 3.7, 4.2, 4.9, 5.1, 5.8, 6.7, 7.1, 8.3, 8.9, 9.5, 10.2, 11.28],
  rsi: [0, 1.8, 0.4, 2.9, 1.7, 4.2, 3.1, 5.8, 4.6, 6.9, 5.2, 8.1, 7.4, 9.8, 8.6, 11.3, 9.7, 12.1, 11.2, 12.91],
};

function EquityChart({ strategy, period }: { strategy: Strategy; period: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const pad = { top: 24, right: 20, bottom: 30, left: 42 };
      const chartW = width - pad.left - pad.right;
      const chartH = height - pad.top - pad.bottom;
      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(126, 143, 172, .12)";
      ctx.lineWidth = 1;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "#62708a";
      for (let i = 0; i <= 4; i += 1) {
        const y = pad.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
        ctx.fillText(`${20 - i * 5}%`, 8, y + 4);
      }

      const data = equitySeries[strategy.id];
      const min = -2;
      const max = 21;
      const point = (value: number, index: number) => ({
        x: pad.left + (index / (data.length - 1)) * chartW,
        y: pad.top + (1 - (value - min) / (max - min)) * chartH,
      });

      const benchmark = data.map((_, index) => index * 0.42 + Math.sin(index * 0.8) * 0.65);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(148, 163, 184, .45)";
      ctx.beginPath();
      benchmark.forEach((value, index) => {
        const p = point(value, index);
        index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      gradient.addColorStop(0, `${strategy.color}35`);
      gradient.addColorStop(1, `${strategy.color}00`);
      ctx.beginPath();
      data.forEach((value, index) => {
        const p = point(value, index);
        index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.lineTo(width - pad.right, height - pad.bottom);
      ctx.lineTo(pad.left, height - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.strokeStyle = strategy.color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      data.forEach((value, index) => {
        const p = point(value, index);
        index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      const last = point(data[data.length - 1], data.length - 1);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = strategy.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(last.x, last.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = `${strategy.color}55`;
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.fillStyle = "#62708a";
      ctx.textAlign = "center";
      ["02-03", "03-04", "04-02", "05-08", period === "近3月" ? "05-30" : "06-18"].forEach((label, index, arr) => {
        ctx.fillText(label, pad.left + (chartW / (arr.length - 1)) * index, height - 8);
      });
      ctx.textAlign = "start";
    };

    draw();
    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [strategy, period]);

  return <canvas ref={ref} aria-label={`${strategy.name}策略净值曲线`} />;
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export default function Home() {
  const [watchlist, setWatchlist] = useState<WatchItem[]>(initialWatchlist);
  const [selectedStock, setSelectedStock] = useState("600519");
  const [selectedStrategy, setSelectedStrategy] = useState(strategies[0]);
  const [period, setPeriod] = useState("近6月");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [position, setPosition] = useState(30);
  const [stopLoss, setStopLoss] = useState(8);
  const [takeProfit, setTakeProfit] = useState(22);
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [runCount, setRunCount] = useState(12);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("paper-alpha-watchlist");
    if (stored) {
      try {
        setWatchlist(JSON.parse(stored));
      } catch {
        window.localStorage.removeItem("paper-alpha-watchlist");
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("paper-alpha-watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        const next = Math.min(100, value + 4);
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => {
            setRunning(false);
            setRunCount((count) => count + 1);
            setToast(`${selectedStrategy.name}模拟完成，结果已更新`);
          }, 220);
        }
        return next;
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [running, selectedStrategy.name]);

  const filteredCandidates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return candidates.filter((item) => !watchlist.some((watch) => watch.code === item.code) && (!keyword || item.code.includes(keyword) || item.name.includes(keyword)));
  }, [search, watchlist]);

  const addStock = (stock: WatchItem) => {
    setWatchlist((items) => [...items, stock]);
    setSelectedStock(stock.code);
    setSearch("");
    setShowSearch(false);
    setToast(`${stock.name}已加入自选`);
  };

  const removeStock = (code: string) => {
    const stock = watchlist.find((item) => item.code === code);
    setWatchlist((items) => items.filter((item) => item.code !== code));
    if (selectedStock === code && watchlist.length > 1) {
      setSelectedStock(watchlist.find((item) => item.code !== code)?.code ?? "");
    }
    setToast(`${stock?.name ?? "股票"}已移出自选`);
  };

  const runSimulation = () => {
    if (running) return;
    setProgress(0);
    setRunning(true);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <b>PAPER ALPHA</b>
            <small>A股策略模拟台</small>
          </div>
        </div>

        <div className="market-strip" aria-label="市场概况">
          <span><i className="live-dot" /> 模拟行情</span>
          <b>上证 <em className="up">+0.68%</em></b>
          <b>深证 <em className="up">+1.12%</em></b>
          <b>创业板 <em className="down">-0.31%</em></b>
        </div>

        <div className="top-actions">
          <span className="trade-day">交易日 · 14:56:28</span>
          <button className="icon-button" aria-label="消息通知">◎<span>3</span></button>
          <button className="account-button"><i>GS</i><span>模拟账户<br /><small>标准版</small></span></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="watch-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">WATCHLIST</span>
              <h2>自选股 <small>{watchlist.length}</small></h2>
            </div>
            <button className="add-button" onClick={() => setShowSearch((value) => !value)} aria-expanded={showSearch}>＋</button>
          </div>

          {showSearch && (
            <div className="stock-search">
              <label htmlFor="stock-search">添加股票</label>
              <input id="stock-search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入代码或名称" />
              <div className="search-results">
                {filteredCandidates.slice(0, 4).map((stock) => (
                  <button key={stock.code} onClick={() => addStock(stock)}>
                    <span>{stock.name}<small>{stock.code}</small></span><b>＋</b>
                  </button>
                ))}
                {filteredCandidates.length === 0 && <p>没有更多匹配股票</p>}
              </div>
            </div>
          )}

          <div className="watch-list">
            {watchlist.map((stock) => (
              <button key={stock.code} className={`watch-row ${selectedStock === stock.code ? "active" : ""}`} onClick={() => setSelectedStock(stock.code)}>
                <span className="stock-identity"><b>{stock.name}</b><small>{stock.code}</small></span>
                <span className="stock-quote"><b>{stock.price.toFixed(2)}</b><small className={stock.change >= 0 ? "up" : "down"}>{stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%</small></span>
                <span className={`signal signal-${stock.signal}`}>{stock.signal}</span>
                <span className="remove-stock" role="button" aria-label={`移除${stock.name}`} onClick={(event) => { event.stopPropagation(); removeStock(stock.code); }}>×</span>
              </button>
            ))}
          </div>

          <div className="watch-footer">
            <div><span>今日信号</span><b>7</b></div>
            <div><span>候选机会</span><b>3</b></div>
            <button onClick={() => setToast("自选股行情已刷新")}>↻ 刷新行情</button>
          </div>
        </aside>

        <section className="main-column">
          <section className="hero panel">
            <div className="hero-copy">
              <div className="eyebrow"><i className="pulse-dot" /> STRATEGY AUTOPILOT</div>
              <h1>策略自动驾驶舱</h1>
              <p>用历史行情驱动虚拟撮合，在真实交易前验证每一个买卖决定。</p>
            </div>
            <div className="hero-meta">
              <div><span>当前策略</span><b>{selectedStrategy.name}</b></div>
              <div><span>策略状态</span><b className="active-status">● 运行中</b></div>
              <div><span>下次扫描</span><b>14:57:00</b></div>
            </div>
          </section>

          <section className="metrics-grid" aria-label="绩效指标">
            <Metric label="模拟总资产" value={selectedStrategy.metrics.equity} />
            <Metric label="累计收益" value={selectedStrategy.metrics.total} tone="up" />
            <Metric label="最大回撤" value={selectedStrategy.metrics.drawdown} tone="down" />
            <Metric label="夏普比率" value={selectedStrategy.metrics.sharpe} />
          </section>

          <section className="chart-panel panel">
            <div className="chart-header">
              <div>
                <span className="eyebrow">PERFORMANCE</span>
                <h2>策略净值</h2>
              </div>
              <div className="legend"><span className="strategy-line" style={{ background: selectedStrategy.color }} />策略净值 <span className="benchmark-line" />沪深300</div>
              <div className="periods" role="group" aria-label="回测时间范围">
                {["近1月", "近3月", "近6月", "今年"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}
              </div>
            </div>
            <div className="chart-canvas"><EquityChart strategy={selectedStrategy} period={period} /></div>
            <div className="chart-summary">
              <div><span>年化收益</span><b className="up">{selectedStrategy.metrics.annual}</b></div>
              <div><span>胜率</span><b>{selectedStrategy.metrics.winRate}</b></div>
              <div><span>模拟交易</span><b>{selectedStrategy.metrics.trades} 笔</b></div>
              <div><span>最近运行</span><b>今天 14:51</b></div>
            </div>
          </section>

          <section className="positions panel">
            <div className="table-header">
              <div>
                <span className="eyebrow">PORTFOLIO</span>
                <h2>当前持仓 <small>3 / 5</small></h2>
              </div>
              <button onClick={() => setToast("持仓明细已导出")}>导出明细 ↗</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>标的</th><th>持仓</th><th>成本价</th><th>现价</th><th>浮动盈亏</th><th>收益率</th></tr></thead>
                <tbody>
                  {positions.map((row) => (
                    <tr key={row.code}><td><b>{row.name}</b><small>{row.code}</small></td><td>{row.shares}</td><td>{row.cost}</td><td>{row.price}</td><td className="up">{row.pnl}</td><td className="up">{row.rate}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="control-column">
          <section className="strategy-panel panel">
            <div className="panel-heading compact">
              <div><span className="eyebrow">STRATEGY</span><h2>策略引擎</h2></div>
              <button className="more-button" aria-label="策略设置">•••</button>
            </div>
            <div className="strategy-list">
              {strategies.map((strategy) => (
                <button key={strategy.id} className={`strategy-card ${selectedStrategy.id === strategy.id ? "active" : ""}`} onClick={() => setSelectedStrategy(strategy)} style={{ "--strategy-color": strategy.color } as React.CSSProperties}>
                  <span className="strategy-radio"><i /></span>
                  <span><b>{strategy.name}</b><small>{strategy.summary}</small></span>
                  <em>{strategy.tag}</em>
                </button>
              ))}
            </div>

            <div className="parameters">
              <div className="section-label"><b>执行参数</b><button onClick={() => { setPosition(30); setStopLoss(8); setTakeProfit(22); }}>恢复默认</button></div>
              <label><span>单票仓位 <b>{position}%</b></span><input type="range" min="10" max="50" step="5" value={position} onChange={(event) => setPosition(Number(event.target.value))} /></label>
              <div className="parameter-pair">
                <label><span>止损线</span><div><input type="number" min="1" max="20" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} /><i>%</i></div></label>
                <label><span>止盈线</span><div><input type="number" min="5" max="50" value={takeProfit} onChange={(event) => setTakeProfit(Number(event.target.value))} /><i>%</i></div></label>
              </div>
              <button className={`toggle-row ${autoRebalance ? "on" : ""}`} onClick={() => setAutoRebalance((value) => !value)} aria-pressed={autoRebalance}><span><b>自动调仓</b><small>每日收盘后检查信号</small></span><i><em /></i></button>
            </div>

            <div className="execution-flow">
              <div className="section-label"><b>自动执行流程</b><span>4 / 4 就绪</span></div>
              <ol>
                <li className="done"><i>✓</i><span><b>扫描自选股</b><small>{watchlist.length} 只标的 · 实时行情</small></span></li>
                <li className="done"><i>✓</i><span><b>计算策略信号</b><small>{selectedStrategy.name} · 参数已校验</small></span></li>
                <li className="done"><i>✓</i><span><b>风控检查</b><small>仓位 / 止损 / 涨跌停</small></span></li>
                <li className="ready"><i>4</i><span><b>虚拟撮合</b><small>佣金 0.025% · 滑点 0.1%</small></span></li>
              </ol>
            </div>

            <button className={`run-button ${running ? "running" : ""}`} onClick={runSimulation} disabled={running}>
              <span>{running ? `正在回放历史行情 ${progress}%` : "▶ 运行模拟"}</span>
              <i style={{ width: `${progress}%` }} />
            </button>
            <p className="run-note">已安全运行 {runCount} 次 · 不会产生真实交易</p>
          </section>

          <section className="activity-panel panel">
            <div className="panel-heading compact"><div><span className="eyebrow">ACTIVITY</span><h2>自动化日志</h2></div><i className="live-dot" /></div>
            <div className="activity-list">
              {activity.map((item) => (
                <div className="activity-item" key={item.time}>
                  <time>{item.time}</time>
                  <span className={item.action === "买入" ? "buy" : "sell"}>{item.action}</span>
                  <p><b>{item.stock}</b><small>{item.detail}</small><em>{item.reason}</em></p>
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => setToast("已展开完整自动化日志")}>查看全部记录 →</button>
          </section>
        </aside>
      </div>

      {toast && <div className="toast" role="status"><i>✓</i>{toast}</div>}
    </main>
  );
}
