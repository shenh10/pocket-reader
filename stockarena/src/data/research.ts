export type ReportSignal = "上修" | "维持" | "下修" | "分歧";

export type ResearchReportDigest = {
  id: string;
  code: string;
  stockName: string;
  date: string;
  source: string;
  title: string;
  rating: string;
  signal: ReportSignal;
  summary: string;
  risks: string[];
  url: string;
};

export type CompanyResearch = {
  code: string;
  name: string;
  sector: string;
  role: string;
  themes: string[];
  reportCount: number;
  consensus: "强共识" | "温和共识" | "分歧加大" | "防御观察";
  reportTrend: ReportSignal;
  themeScore: number;
  fundamentalScore: number;
  riskScore: number;
  thesis: string;
  monitor: string[];
};

export type ThemeCluster = {
  name: string;
  heat: number;
  stage: "业绩兑现" | "主题发酵" | "政策催化" | "防御配置";
  leaders: string[];
  recommendation?: "重点跟踪" | "趋势观察" | "过热等待" | "低优先级";
  recommendationScore?: number;
  reason?: string;
  action?: string;
  trigger?: string;
  source?: string;
  updatedAt?: string;
  metrics?: Array<{
    label: string;
    value: string;
    tone?: "good" | "watch" | "risk" | "neutral";
  }>;
  catalysts: string[];
  risks: string[];
};

export type AnalysisFrameworkStep = {
  name: string;
  weight: number;
  objective: string;
  metrics: string[];
};

export type DataSourceLayer = {
  name: string;
  status: "已接入前端模型" | "需要服务端配置" | "公开种子库" | "官方事实源" | "授权增强源";
  fields: string[];
};

export type HkResearchSource = {
  name: string;
  layer: "官方事实源" | "公开研报入口" | "公司IR补充" | "授权完整库";
  status: "已在线探测" | "本机探测失败" | "待合规适配" | "需要授权";
  coverage: string[];
  useCase: string;
  links: Array<{
    label: string;
    url: string;
  }>;
};

export const analysisFramework: AnalysisFrameworkStep[] = [
  {
    name: "研报共识",
    weight: 24,
    objective: "抽取最近 12-18 个月机构观点，识别盈利预测上修、评级变化和分歧来源。",
    metrics: ["报告数量", "机构覆盖", "评级方向", "目标价变化", "盈利预测修正"]
  },
  {
    name: "基本面质量",
    weight: 22,
    objective: "用财报和一致预期验证增长、盈利能力、现金流和估值分位。",
    metrics: ["营收增速", "归母净利增速", "ROE", "毛利率", "经营现金流", "PE/PB 分位"]
  },
  {
    name: "题材板块",
    weight: 18,
    objective: "判断题材是否从概念扩散进入订单、业绩和产业链验证。",
    metrics: ["政策催化", "产业订单", "景气指标", "龙头扩散", "拥挤度"]
  },
  {
    name: "技术资金",
    weight: 16,
    objective: "用量价趋势和资金行为决定买点、止损和仓位节奏。",
    metrics: ["MA20/MA60", "RSI", "MACD", "换手率", "主力净额", "北向资金"]
  },
  {
    name: "信息流冲击",
    weight: 12,
    objective: "把公告、新闻、研报、舆情事件映射到投资结论的边际变化。",
    metrics: ["事件类型", "影响度", "情绪倾向", "是否改变盈利假设"]
  },
  {
    name: "风险折扣",
    weight: 8,
    objective: "对高估值、业绩证伪、政策变化和交易拥挤给出扣分。",
    metrics: ["估值拥挤", "预期差", "政策风险", "价格战", "外部限制"]
  }
];

export const dataSourceLayers: DataSourceLayer[] = [
  {
    name: "东方财富 Push2",
    status: "已接入前端模型",
    fields: ["A股快照", "指数", "日K线", "成交额", "估值基础字段"]
  },
  {
    name: "东方财富 Push2 clist",
    status: "已接入前端模型",
    fields: ["A/H股票池", "代码搜索", "行业/概念标签", "热门板块", "板块领涨股"]
  },
  {
    name: "Tushare Pro",
    status: "需要服务端配置",
    fields: ["财务指标", "日线历史", "股票基础资料", "复权因子", "部分公告"]
  },
  {
    name: "AKShare",
    status: "公开种子库",
    fields: ["行情聚合", "宏观", "行业数据", "研报索引", "新闻数据"]
  },
  {
    name: "BaoStock",
    status: "公开种子库",
    fields: ["历史行情", "复权", "财务季频数据", "指数历史"]
  },
  {
    name: "巨潮/交易所/东方财富研报",
    status: "公开种子库",
    fields: ["公告 PDF", "年报季报", "券商 PDF", "公开新闻", "板块观点"]
  },
  {
    name: "HKEXnews / 港交所披露易",
    status: "官方事实源",
    fields: ["港股公告", "年报", "中报", "业绩公告", "回购与权益披露"]
  },
  {
    name: "AAStocks AAFN / 公司IR",
    status: "公开种子库",
    fields: ["港股新闻", "大行观点索引", "公司公告入口", "业绩会材料"]
  },
  {
    name: "Wind / Choice / iFinD / FactSet / LSEG / Bloomberg",
    status: "授权增强源",
    fields: ["完整券商研报全文", "盈利预测", "目标价历史", "一致预期", "机构覆盖"]
  }
];

export const hkResearchSources: HkResearchSource[] = [
  {
    name: "HKEXnews 披露易",
    layer: "官方事实源",
    status: "已在线探测",
    coverage: ["公告", "年报/中报", "业绩公告", "回购", "权益披露"],
    useCase: "港股基本面事实底座：所有研报观点必须回到公告、财报和业绩会事实校验。",
    links: [
      { label: "披露易首页", url: "https://www.hkexnews.hk/" },
      { label: "公告标题搜索", url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh" }
    ]
  },
  {
    name: "AAStocks AAFN",
    layer: "公开研报入口",
    status: "已在线探测",
    coverage: ["Research Report", "Analysts' Views", "个股新闻", "公司公告入口"],
    useCase: "适合做港股信息流与大行观点索引，但需要保留原始链接和免责声明，不能当作完整研报库。",
    links: [
      { label: "AAFN Research Report", url: "https://www.aastocks.com/en/stocks/news/aafn/research-report" },
      { label: "腾讯个股新闻", url: "https://www.aastocks.com/en/stocks/analysis/stock-aafn/00700/0/hk-stock-news/1" }
    ]
  },
  {
    name: "腾讯控股 IR",
    layer: "公司IR补充",
    status: "已在线探测",
    coverage: ["业绩公告", "业绩演示材料", "年度报告", "投资者公告"],
    useCase: "用于校验腾讯收入结构、管理层指引、回购和资本开支，不替代卖方研报。",
    links: [
      { label: "Tencent Investors", url: "https://www.tencent.com/en-us/investors.html" }
    ]
  },
  {
    name: "阿里巴巴 IR",
    layer: "公司IR补充",
    status: "已在线探测",
    coverage: ["业绩公告", "SEC/HKEX 文件", "投资者演示", "财务数据"],
    useCase: "用于校验阿里电商、云业务、回购和资本配置等事实信息。",
    links: [
      { label: "Alibaba IR", url: "https://www.alibabagroup.com/en-US/ir/home" }
    ]
  },
  {
    name: "小米集团 IR",
    layer: "公司IR补充",
    status: "已在线探测",
    coverage: ["业绩公告", "公告通函", "财报材料", "公司治理"],
    useCase: "用于校验小米手机、IoT、汽车业务交付和利润率等事实信息。",
    links: [
      { label: "Xiaomi IR", url: "https://ir.mi.com/investor-relations/" }
    ]
  },
  {
    name: "授权研报与一致预期终端",
    layer: "授权完整库",
    status: "需要授权",
    coverage: ["券商研报全文", "盈利预测", "目标价修订", "一致预期", "机构覆盖历史"],
    useCase: "完整卖方研报、目标价历史和一致预期必须来自授权终端或合规自建库；页面不会用单一供应商链接代表全部。",
    links: [
      { label: "Wind", url: "https://www.wind.com.cn/" },
      { label: "Choice", url: "https://choice.eastmoney.com/" },
      { label: "iFinD", url: "https://www.51ifind.com/" },
      { label: "FactSet", url: "https://www.factset.com/" },
      { label: "LSEG", url: "https://www.lseg.com/en/data-analytics" },
      { label: "Bloomberg", url: "https://www.bloomberg.com/professional/" }
    ]
  }
];

export const themeClusters: ThemeCluster[] = [
  {
    name: "AI算力硬件",
    heat: 96,
    stage: "业绩兑现",
    leaders: ["中际旭创", "工业富联", "沪电股份", "新易盛"],
    catalysts: ["云厂商资本开支", "800G/1.6T 光模块", "AI服务器升级", "高端 PCB 需求"],
    risks: ["海外客户集中", "关税与供应链限制", "CPO/AEC 技术替代争议", "估值拥挤"]
  },
  {
    name: "半导体国产替代",
    heat: 91,
    stage: "业绩兑现",
    leaders: ["北方华创", "中芯国际", "中微公司", "海光信息"],
    catalysts: ["先进制程国产替代", "设备订单", "AI芯片需求", "政策与资本开支"],
    risks: ["出口管制", "周期波动", "资本开支不及预期", "技术迭代不确定"]
  },
  {
    name: "人形机器人",
    heat: 88,
    stage: "主题发酵",
    leaders: ["三花智控", "汇川技术", "拓普集团", "绿的谐波"],
    catalysts: ["量产节点", "执行器与传感器", "特斯拉链", "国内本体供应链"],
    risks: ["订单验证不足", "成本下降速度", "估值先行", "技术路线变化"]
  },
  {
    name: "固态电池/储能",
    heat: 83,
    stage: "政策催化",
    leaders: ["宁德时代", "比亚迪", "阳光电源", "先导智能"],
    catalysts: ["电池技术迭代", "海外储能", "商用车电动化", "车企新品周期"],
    risks: ["价格战", "材料体系路线", "海外贸易壁垒", "产能利用率"]
  },
  {
    name: "创新药出海",
    heat: 68,
    stage: "业绩兑现",
    leaders: ["恒瑞医药", "百济神州", "信达生物", "迈瑞医疗"],
    catalysts: ["BD授权", "临床读出", "医保控费边际缓和", "国产设备替代"],
    risks: ["临床失败", "集采扰动", "海外审批", "研发费用压力"]
  },
  {
    name: "高股息/核心资产",
    heat: 54,
    stage: "防御配置",
    leaders: ["中国移动", "招商银行", "贵州茅台", "长江电力"],
    catalysts: ["利率下行", "分红政策", "资金避险", "估值修复"],
    risks: ["成长弹性不足", "消费需求疲弱", "银行资产质量", "拥挤切换"]
  }
];

export const companyResearch: CompanyResearch[] = [
  {
    code: "300308",
    name: "中际旭创",
    sector: "光模块",
    role: "AI 算力光模块龙头",
    themes: ["AI算力硬件", "CPO", "海外云资本开支"],
    reportCount: 6,
    consensus: "强共识",
    reportTrend: "上修",
    themeScore: 96,
    fundamentalScore: 92,
    riskScore: 36,
    thesis: "研报共识集中在 800G/1.6T 放量、海外 AI 资本开支和盈利弹性，核心变量是订单持续性与技术替代路径。",
    monitor: ["北美云厂商 CapEx 指引", "1.6T 出货节奏", "毛利率", "海外收入与关税风险"]
  },
  {
    code: "601138",
    name: "工业富联",
    sector: "AI服务器",
    role: "AI 服务器制造核心平台",
    themes: ["AI算力硬件", "服务器", "液冷"],
    reportCount: 4,
    consensus: "强共识",
    reportTrend: "上修",
    themeScore: 90,
    fundamentalScore: 84,
    riskScore: 32,
    thesis: "受益 AI 服务器需求与供应链重构，市场关注高端服务器占比、毛利率改善和客户订单可持续性。",
    monitor: ["AI服务器收入占比", "液冷/超节点进展", "大客户订单", "毛利率"]
  },
  {
    code: "002463",
    name: "沪电股份",
    sector: "PCB",
    role: "AI服务器高端 PCB 龙头",
    themes: ["AI算力硬件", "PCB", "高速通信"],
    reportCount: 5,
    consensus: "强共识",
    reportTrend: "上修",
    themeScore: 91,
    fundamentalScore: 86,
    riskScore: 34,
    thesis: "高端 PCB 与交换机/服务器需求带来利润弹性，需跟踪产能、良率、客户认证和单价趋势。",
    monitor: ["高阶 PCB 产能", "AI服务器订单", "毛利率", "客户认证"]
  },
  {
    code: "002371",
    name: "北方华创",
    sector: "半导体设备",
    role: "国产半导体设备平台型龙头",
    themes: ["半导体国产替代", "设备订单", "先进制程"],
    reportCount: 5,
    consensus: "强共识",
    reportTrend: "维持",
    themeScore: 89,
    fundamentalScore: 88,
    riskScore: 30,
    thesis: "国产替代和晶圆厂资本开支支撑中期增长，关键在订单能见度和产品线向高端环节突破。",
    monitor: ["新增订单", "合同负债", "研发投入", "晶圆厂 CapEx"]
  },
  {
    code: "688981",
    name: "中芯国际",
    sector: "晶圆制造",
    role: "国产晶圆制造核心资产",
    themes: ["半导体国产替代", "先进制程", "AI芯片"],
    reportCount: 4,
    consensus: "温和共识",
    reportTrend: "维持",
    themeScore: 86,
    fundamentalScore: 72,
    riskScore: 42,
    thesis: "题材权重高于短期盈利，研报更关注产能利用率、ASP、折旧压力和国产供应链突破。",
    monitor: ["产能利用率", "ASP", "资本开支", "折旧与毛利率"]
  },
  {
    code: "300750",
    name: "宁德时代",
    sector: "动力电池",
    role: "全球动力电池与储能龙头",
    themes: ["固态电池/储能", "商用车电动化", "海外储能"],
    reportCount: 7,
    consensus: "强共识",
    reportTrend: "上修",
    themeScore: 84,
    fundamentalScore: 90,
    riskScore: 28,
    thesis: "公开研报强调份额韧性、出货增长和储能弹性，核心监控点是价格压力、海外扩张和新技术迭代。",
    monitor: ["动力/储能出货", "毛利率", "海外收入", "固态电池进展"]
  },
  {
    code: "002594",
    name: "比亚迪",
    sector: "整车",
    role: "新能源整车与电池一体化龙头",
    themes: ["新能源车", "出口", "智能驾驶"],
    reportCount: 5,
    consensus: "温和共识",
    reportTrend: "维持",
    themeScore: 80,
    fundamentalScore: 83,
    riskScore: 36,
    thesis: "销量、出口和新品周期仍是主线，但价格竞争与利润率是机构分歧来源。",
    monitor: ["月度销量", "出口占比", "单车利润", "高阶智驾渗透"]
  },
  {
    code: "300274",
    name: "阳光电源",
    sector: "逆变器/储能",
    role: "全球逆变器与储能系统龙头",
    themes: ["固态电池/储能", "海外储能", "光伏修复"],
    reportCount: 4,
    consensus: "强共识",
    reportTrend: "维持",
    themeScore: 82,
    fundamentalScore: 84,
    riskScore: 33,
    thesis: "储能业务全球化和盈利韧性是主要支撑，需关注海外政策、库存和价格竞争。",
    monitor: ["储能订单", "海外毛利率", "渠道库存", "光伏装机"]
  },
  {
    code: "300124",
    name: "汇川技术",
    sector: "工控/机器人",
    role: "工业自动化与机器人部件龙头",
    themes: ["人形机器人", "工控复苏", "新能源车"],
    reportCount: 4,
    consensus: "温和共识",
    reportTrend: "维持",
    themeScore: 78,
    fundamentalScore: 82,
    riskScore: 31,
    thesis: "工控复苏和机器人零部件打开估值想象，订单与下游制造景气度决定弹性。",
    monitor: ["通用自动化订单", "机器人部件进展", "新能源车业务", "毛利率"]
  },
  {
    code: "002050",
    name: "三花智控",
    sector: "热管理/机器人",
    role: "热管理与机器人执行器供应链龙头",
    themes: ["人形机器人", "特斯拉链", "汽车热管理"],
    reportCount: 4,
    consensus: "强共识",
    reportTrend: "上修",
    themeScore: 87,
    fundamentalScore: 80,
    riskScore: 38,
    thesis: "机器人执行器弹性提升估值，汽车热管理提供基本盘，需验证量产订单和单机价值量。",
    monitor: ["机器人订单", "特斯拉链进展", "热管理份额", "单机价值量"]
  },
  {
    code: "600519",
    name: "贵州茅台",
    sector: "白酒",
    role: "高端白酒核心资产",
    themes: ["高股息/核心资产", "消费复苏"],
    reportCount: 6,
    consensus: "防御观察",
    reportTrend: "分歧",
    themeScore: 52,
    fundamentalScore: 86,
    riskScore: 35,
    thesis: "基本盘强但渠道价格、需求和改革节奏带来分歧，适合作为核心资产和防御配置观察。",
    monitor: ["批价", "渠道库存", "直营占比", "分红与回购"]
  },
  {
    code: "000858",
    name: "五粮液",
    sector: "白酒",
    role: "浓香白酒龙头",
    themes: ["高股息/核心资产", "消费复苏"],
    reportCount: 4,
    consensus: "分歧加大",
    reportTrend: "下修",
    themeScore: 45,
    fundamentalScore: 62,
    riskScore: 52,
    thesis: "品牌仍具备核心地位，但渠道库存、普五批价和报表调整使机构对盈利预测明显下修。",
    monitor: ["普五批价", "渠道库存", "回款与现金流", "回购分红"]
  },
  {
    code: "600276",
    name: "恒瑞医药",
    sector: "创新药",
    role: "创新药出海龙头",
    themes: ["创新药出海", "医保边际改善"],
    reportCount: 5,
    consensus: "温和共识",
    reportTrend: "上修",
    themeScore: 74,
    fundamentalScore: 78,
    riskScore: 39,
    thesis: "创新药管线与海外授权提升中期弹性，短期看研发兑现、医保和集采扰动。",
    monitor: ["BD 授权", "临床读出", "创新药收入", "研发费用率"]
  },
  {
    code: "300760",
    name: "迈瑞医疗",
    sector: "医疗设备",
    role: "国产医疗设备龙头",
    themes: ["创新药出海", "医疗设备国产替代", "海外扩张"],
    reportCount: 4,
    consensus: "分歧加大",
    reportTrend: "下修",
    themeScore: 66,
    fundamentalScore: 70,
    riskScore: 44,
    thesis: "海外收入和 IVD、新兴业务支撑长期逻辑，但国内招采恢复偏慢导致短期盈利预测被下修。",
    monitor: ["国内中标额", "国际收入增速", "IVD 装机", "合同负债"]
  },
  {
    code: "600036",
    name: "招商银行",
    sector: "银行",
    role: "零售银行核心资产",
    themes: ["高股息/核心资产", "资产质量"],
    reportCount: 3,
    consensus: "防御观察",
    reportTrend: "维持",
    themeScore: 45,
    fundamentalScore: 76,
    riskScore: 29,
    thesis: "估值和分红具备防御属性，但弹性取决于净息差、财富管理修复和资产质量预期。",
    monitor: ["净息差", "不良率", "拨备覆盖", "财富管理收入"]
  },
  {
    code: "600941",
    name: "中国移动",
    sector: "通信运营",
    role: "高股息央企与算力基础设施",
    themes: ["高股息/核心资产", "AI算力硬件", "央企价值"],
    reportCount: 4,
    consensus: "防御观察",
    reportTrend: "维持",
    themeScore: 72,
    fundamentalScore: 78,
    riskScore: 26,
    thesis: "现金流和分红提供防御底盘，AI 算力和数字化业务打开第二增长曲线，但利润短期受税改和资本开支影响。",
    monitor: ["派息率", "自由现金流", "算力收入", "资本开支结构"]
  }
];

export const reportDigests: ResearchReportDigest[] = [
  {
    id: "rpt-300308-20260402",
    code: "300308",
    stockName: "中际旭创",
    date: "2026-04-02",
    source: "东方财富研报 PDF / 券商年报点评",
    title: "2025 年报点评：业绩符合预期",
    rating: "买入/维持",
    signal: "上修",
    summary: "公开摘要显示 2025 年营收与归母净利高速增长，券商继续把 AI 光模块放量作为核心盈利驱动。",
    risks: ["海外客户集中", "关税风险", "新技术替代"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202604021820983821_1.pdf?1775150811000.pdf="
  },
  {
    id: "rpt-300308-20260203",
    code: "300308",
    stockName: "中际旭创",
    date: "2026-02-03",
    source: "东方财富研报 PDF / 业绩预告点评",
    title: "2025 年业绩预告点评",
    rating: "买入/维持",
    signal: "上修",
    summary: "业绩预告显示利润区间大幅增长，机构关注 1.6T 出货与云厂商 AI 资本开支。",
    risks: ["订单节奏", "汇率", "CPO/AEC 竞争"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202602031819431265_1.pdf?1770099431000.pdf="
  },
  {
    id: "rpt-300750-20260322",
    code: "300750",
    stockName: "宁德时代",
    date: "2026-03-22",
    source: "东方财富研报 PDF / 东吴证券",
    title: "技术迭代引领行业，盈利与规模共振向上",
    rating: "买入/维持",
    signal: "上修",
    summary: "研报强调宁德时代在新能源商用车电池和储能等场景维持龙头地位，规模与盈利弹性同步改善。",
    risks: ["价格竞争", "海外政策", "原材料波动"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202603221820688666_1.pdf?1774246477000.pdf="
  },
  {
    id: "rpt-300750-20260310",
    code: "300750",
    stockName: "宁德时代",
    date: "2026-03-10",
    source: "东方财富研报 PDF / 年报点评",
    title: "2025 年年报点评：盈利与出货双升",
    rating: "买入/维持",
    signal: "上修",
    summary: "公开摘要显示 2025 年营收、利润与未来盈利预测均保持增长，机构对出货与份额韧性形成较强共识。",
    risks: ["行业价格战", "产能利用率", "贸易壁垒"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202603101820437630_1.pdf?1773134570000.pdf="
  },
  {
    id: "rpt-600519-20260303",
    code: "600519",
    stockName: "贵州茅台",
    date: "2026-03-03",
    source: "东方财富研报 PDF / 东吴证券",
    title: "营销改革复盘专题",
    rating: "买入/维持",
    signal: "分歧",
    summary: "研报讨论渠道改革与动销筑底，同时将 2025-2027 年盈利预测微调，显示长期韧性与短期压力并存。",
    risks: ["需求不及预期", "批价波动", "库存去化慢"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202603031820234429_1.pdf?1772574809000.pdf="
  },
  {
    id: "rpt-600519-20251214",
    code: "600519",
    stockName: "贵州茅台",
    date: "2025-12-14",
    source: "东方财富研报 PDF / 东吴证券",
    title: "量价调控思路清晰，长期韧性值得信赖",
    rating: "买入/维持",
    signal: "维持",
    summary: "机构认为量价调控和渠道管理仍是观察重点，长期品牌韧性较强，但短期弹性受消费需求影响。",
    risks: ["白酒需求", "价格体系", "行业竞争"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202512141800352882_1.pdf?1765732487000.pdf="
  },
  {
    id: "rpt-000858-20260506",
    code: "000858",
    stockName: "五粮液",
    date: "2026-05-06",
    source: "东方财富研报 PDF / 东吴证券",
    title: "下行期主动出清，回购与分红增强股东回报",
    rating: "买入/维持",
    signal: "下修",
    summary: "机构下调 2026/2027 年盈利预测，认为主动出清和股东回报能提供支撑，但基本面修复仍需批价与库存验证。",
    risks: ["批价继续下行", "渠道库存", "消费场景复苏慢"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202605061821981682_1.pdf?1778061597000.pdf="
  },
  {
    id: "rpt-600276-20260506",
    code: "600276",
    stockName: "恒瑞医药",
    date: "2026-05-06",
    source: "东方财富研报 PDF / 东吴证券",
    title: "商业化投入加大，创新药与出海逻辑延续",
    rating: "买入/维持",
    signal: "分歧",
    summary: "维持买入，但短期盈利预测因商业化投入下调；创新药收入和海外合作仍是中期上修主线。",
    risks: ["临床失败", "商业化费用", "海外监管"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202605061821996970_1.pdf"
  },
  {
    id: "rpt-600276-20260512",
    code: "600276",
    stockName: "恒瑞医药",
    date: "2026-05-12",
    source: "恒瑞医药公告 / BMS 合作",
    title: "与 BMS 达成多个早期项目全球合作",
    rating: "事件催化",
    signal: "上修",
    summary: "BMS 合作强化创新药出海预期，市场关注首付款、里程碑兑现和后续临床进展。",
    risks: ["项目早期", "交割不确定", "地缘与监管"],
    url: "https://www.hengrui.com/media/detail-950.html"
  },
  {
    id: "rpt-300760-20260502",
    code: "300760",
    stockName: "迈瑞医疗",
    date: "2026-05-02",
    source: "东方财富研报 PDF / 东吴证券",
    title: "国内招投标恢复偏慢，海外与新兴业务支撑长期逻辑",
    rating: "买入/维持",
    signal: "下修",
    summary: "因国内招投标恢复偏慢，机构明显下调 2026/2027 年盈利预测；海外收入、IVD 和新兴业务是修复观察点。",
    risks: ["国内需求恢复慢", "海外地缘", "并购整合"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202605021821935479_1.pdf?1777761424000.pdf="
  },
  {
    id: "rpt-600036-20260429",
    code: "600036",
    stockName: "招商银行",
    date: "2026-04-29",
    source: "东方财富研报 PDF / 国信证券",
    title: "财富管理手续费回暖，净息差降幅收窄",
    rating: "优于大市/维持",
    signal: "维持",
    summary: "净息差降幅收窄、财富管理收入修复，资产质量仍优于同业，红利和银行修复逻辑并存。",
    risks: ["宏观复苏偏弱", "零售信贷风险", "房地产资产质量"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202604291821731872_1.pdf?1777469252000.pdf="
  },
  {
    id: "rpt-600941-20260429",
    code: "600941",
    stockName: "中国移动",
    date: "2026-04-29",
    source: "华创证券 / 公开研报摘要",
    title: "高股息底盘稳，AI 算力与数字化业务提供第二曲线",
    rating: "推荐/维持",
    signal: "维持",
    summary: "短期利润受税改压制，但高派息、自由现金流和算力业务使其兼具红利和 AI 基建属性。",
    risks: ["ARPU 下行", "资本开支回报周期", "税费扰动"],
    url: "https://m.hibor.com.cn/wap_detail.aspx?id=71cdcda9f3aa0cbe5bf9c15e0f4dc2e9"
  },
  {
    id: "rpt-601138-20260429",
    code: "601138",
    stockName: "工业富联",
    date: "2026-04-29",
    source: "公司一季报 / 公司新闻",
    title: "AI GPU 机柜与 ASIC 服务器出货高增",
    rating: "事件验证",
    signal: "上修",
    summary: "2026Q1 AI GPU 机柜、AI ASIC 服务器和 CPO 样机出货强化 AI 服务器主线，机构关注高端服务器占比与毛利率。",
    risks: ["客户集中", "商业模式变化", "库存与减值"],
    url: "https://www.fii-foxconn.com/NewsDetail?id=4868"
  },
  {
    id: "rpt-601138-20260311",
    code: "601138",
    stockName: "工业富联",
    date: "2026-03-11",
    source: "公司 2025 年报",
    title: "AI 服务器收入同比大幅增长，云计算业务成为核心驱动",
    rating: "年报验证",
    signal: "上修",
    summary: "年报显示云计算和 AI 服务器业务强兑现，高速交换机与服务器链条构成业绩主轴。",
    risks: ["地缘政治", "汇率", "原材料价格"],
    url: "https://static.cninfo.com.cn/finalpage/2026-03-11/1225004420.PDF"
  },
  {
    id: "rpt-002463-20260402",
    code: "002463",
    stockName: "沪电股份",
    date: "2026-04-02",
    source: "东方财富研报 PDF / 年报点评",
    title: "高端 PCB 需求强，AI 服务器与高速交换机共振",
    rating: "买入/维持",
    signal: "上修",
    summary: "数据通讯 PCB 收入高增，交换机与 AI 服务器/HPC 需求推动产品结构升级。",
    risks: ["扩产爬坡", "原料价格", "汇兑波动"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202604021820982346_1.pdf?1775149396000.pdf="
  },
  {
    id: "rpt-002463-20260212",
    code: "002463",
    stockName: "沪电股份",
    date: "2026-02-12",
    source: "证券时报 / 公司公告",
    title: "拟投 33 亿元建设高端 PCB 项目",
    rating: "扩产催化",
    signal: "上修",
    summary: "扩产面向高速运算服务器和下一代高速交换机，强化 AI 硬件链产能逻辑。",
    risks: ["需求兑现", "资本开支回报", "良率爬坡"],
    url: "https://www.stcn.com/article/detail/3642002.html"
  },
  {
    id: "rpt-002371-20260502",
    code: "002371",
    stockName: "北方华创",
    date: "2026-05-02",
    source: "东方财富研报 PDF / 一季报点评",
    title: "设备平台化持续推进，研发投入压制短期利润",
    rating: "买入/维持",
    signal: "分歧",
    summary: "刻蚀、薄膜、热处理、清洗等产品线市占率提升，但研发与并购整合使利润弹性阶段性受压。",
    risks: ["验证周期", "下游资本开支", "研发费用高增"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202605021821935363_1.pdf?1777756548000.pdf="
  },
  {
    id: "rpt-002371-20251104",
    code: "002371",
    stockName: "北方华创",
    date: "2025-11-04",
    source: "东方财富研报 PDF / 东海证券",
    title: "平台型设备龙头，受益晶圆厂扩产与国产替代",
    rating: "买入/维持",
    signal: "上修",
    summary: "2025Q1-Q3 收入与利润增长，机构看好设备国产替代与产品平台化。",
    risks: ["产品验证", "地缘限制", "下游需求"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202511041775040006_1.pdf"
  },
  {
    id: "rpt-688981-20250105",
    code: "688981",
    stockName: "中芯国际",
    date: "2025-01-05",
    source: "东方财富研报 PDF",
    title: "大陆晶圆代工龙头，受益 AI 芯片和国产替代",
    rating: "买入/首次",
    signal: "上修",
    summary: "研报将国产 AI 芯片需求和晶圆代工国产替代作为主要支撑，关注制程突破和产能利用率。",
    risks: ["海外限制", "技术升级", "周期波动"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202501051641812018_1.pdf"
  },
  {
    id: "rpt-688981-20260518",
    code: "688981",
    stockName: "中芯国际",
    date: "2026-05-18",
    source: "新浪财经 / 业绩指引",
    title: "产能利用率维持高位，Q2 收入指引环比增长",
    rating: "经营跟踪",
    signal: "上修",
    summary: "2025 年收入和产能利用率处于高位，2026Q2 指引环比增长，但折旧和资本开支仍影响利润质量。",
    risks: ["折旧压力", "资本开支", "设备限制"],
    url: "https://finance.sina.com.cn/roll/2026-05-18/doc-inhyhisu0890190.shtml"
  },
  {
    id: "rpt-002594-20260429",
    code: "002594",
    stockName: "比亚迪",
    date: "2026-04-29",
    source: "东方财富研报 PDF / 东吴证券",
    title: "出口与技术周期支撑，短期利润受价格战扰动",
    rating: "买入/维持",
    signal: "分歧",
    summary: "出海需求和闪充技术构成新周期，但 2026Q1 利润下滑使市场更关注单车利润和国内价格竞争。",
    risks: ["价格战", "渠道库存", "海外政策"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202604291821739552_1.pdf"
  },
  {
    id: "rpt-300274-20260428",
    code: "300274",
    stockName: "阳光电源",
    date: "2026-04-28",
    source: "东方财富研报 PDF / 东吴证券",
    title: "储能长期高景气，短期盈利预测承压",
    rating: "买入/维持",
    signal: "分歧",
    summary: "储能和 AIDC 电源是长期看点，但 2026Q1 收入与利润下降使市场关注毛利率与海外订单兑现。",
    risks: ["储能价格竞争", "汇兑", "海外政策"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202604281821656418_1.pdf"
  },
  {
    id: "rpt-300124-20260428",
    code: "300124",
    stockName: "汇川技术",
    date: "2026-04-28",
    source: "东方财富研报 PDF / 东吴证券",
    title: "工控需求复苏，新能源车业务短期承压",
    rating: "买入/维持",
    signal: "维持",
    summary: "通用自动化和运动控制复苏是主线，车端价格压力和机器人兑现节奏决定估值弹性。",
    risks: ["制造业周期", "车端毛利", "机器人放量慢"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202604281821656918_1.pdf"
  },
  {
    id: "rpt-002050-20260502",
    code: "002050",
    stockName: "三花智控",
    date: "2026-05-02",
    source: "东方财富研报 PDF / 东吴证券",
    title: "人形机器人执行器弹性提升，传统热管理提供基本盘",
    rating: "买入/维持",
    signal: "上修",
    summary: "机器人执行器预期提升题材弹性，汽车热管理和制冷业务提供利润底盘。",
    risks: ["机器人量产不及预期", "估值透支", "汇率"],
    url: "https://pdf.dfcfw.com/pdf/H3_AP202605021821930412_1.pdf"
  }
];

export function getResearchByCode(code: string) {
  return companyResearch.find((item) => item.code === code);
}

export function getReportsByCode(code: string) {
  return reportDigests.filter((report) => report.code === code);
}
