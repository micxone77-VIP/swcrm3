// src/lib/surveyLabels.js — 中文 for the survey answer labels stored in vip_survey_responses (see surveyImport.js)
export const SURVEY_ZH = {
  // reasons / activity drop
  'Busy recently': '最近比较忙', 'Taking a break': '暂时想休息', 'Using other platforms': '更多使用其他平台', 'Managing budget': '控制消费',
  'Benefits do not match': 'VIP 福利不符合需求', 'Lost all money': '输光了', 'Still active': '一直有上线',
  'Lost a lot, taking a break': '输钱比较多，想休息', 'Other platforms better': '其他平台福利/返水更好', 'Personal reasons': '个人原因',
  'Upgrade / keep-tier pressure': '升级/保级压力大', 'Bank tracking transactions': '担心银行追查交易',
  // rewards / return drivers
  'Cashback / rebate': '返现 / 返水', 'Free credit': '免费积分', 'VIP exclusive rewards': 'VIP 专属奖励', 'Birthday rewards': '生日福利',
  'Physical gifts': '实物礼品', 'Personalised offers': '个人专属福利', 'Exclusive events': 'VIP 专属活动', 'Deposit bonus': '存款优惠',
  'Higher deposit bonus': '更高存款优惠', 'More cashback / rebate': '更多返现', 'Personalised VIP offers': '个人专属福利',
  'More VIP exclusive rewards': '更多 VIP 专属奖励', 'Faster transactions': '更快的交易',
  // manager
  'Early promo notice': '第一时间通知活动', 'Personalised rewards': '按喜好的专属福利', 'More cashback offers': '更多返现福利',
  'More exclusive bonuses': '更多专属优惠', 'Birthday / festival rewards': '生日 / 节日福利', 'Faster help': '更快的协助',
  // deposit factor / better elsewhere
  'Withdrawal': '提款', 'Platform stability': '平台稳定性', 'Exclusive promotions': '专属活动',
  'Faster deposit / withdrawal': '更快的存提款', 'Higher rebate': '更高返水', 'Better loss care': '输钱后更好的关怀/补偿',
  'More attractive promotions': '更吸引的活动', 'Easier upgrade / keep-tier': '更宽松的升级/保级', 'No cash withdrawal fee': '提现金不收手续费',
  'sureWin is steady': 'sureWin 稳', 'sureWin only': '只玩 sureWin',
  // benefit feeling / channel
  good: '很好，愿意继续', average: '一般，可有可无', decreased: '变少了 / 不如以前', unclear: '不清楚有什么权益',
  WhatsApp: 'WhatsApp', 'App notification': 'App 通知',
}
export const FEELING_EN = { good: 'Good, will continue', average: 'Average, optional', decreased: 'Less than before', unclear: "Doesn't know their benefits" }
export const FEELING_COLOR = { good: '#3fb950', average: '#8b949e', decreased: '#f85149', unclear: '#d29922' }

// label in the UI language; "Other: …" free text stays as typed
export const surveyLabel = (v, lang) => (lang === 'zh' ? SURVEY_ZH[v] || v : v)
