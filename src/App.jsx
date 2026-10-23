// src/App.jsx — V3 routing with permKey-based access control
import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }      from './hooks/useAuth'
import { LanguageProvider }  from './contexts/LanguageContext'
import Layout                from './components/Layout'
import RequireRole           from './components/RequireRole'
import Login                 from './pages/Login'
// Pages load only when opened (keeps the first download small); Layout shows a loading line meanwhile.
// After a new deploy the old page files are gone: if this browser still runs the previous version and a page
// file can't be fetched, reload once to pick up the new version (a second failure shows the error instead of looping).
const RELOAD_FLAG = 'crm-chunk-reload'
function lazyPage(loader) {
  return lazy(() => loader().then(mod => { sessionStorage.removeItem(RELOAD_FLAG); return mod }, err => {
    if (!sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1')
      window.location.reload()
      return new Promise(() => {})
    }
    sessionStorage.removeItem(RELOAD_FLAG)
    throw err
  }))
}
const Today = lazyPage(() => import('./pages/Today'))
const MyTasks = lazyPage(() => import('./pages/MyTasks'))
const Alerts = lazyPage(() => import('./pages/Alerts'))
const AllVIPs = lazyPage(() => import('./pages/AllVIPs'))
const Segments = lazyPage(() => import('./pages/Segments'))
const ManagerKPI = lazyPage(() => import('./pages/ManagerKPI'))
const ExecOverview = lazyPage(() => import('./pages/ExecOverview'))
const VIP360 = lazyPage(() => import('./pages/VIP360'))
const AtRisk = lazyPage(() => import('./pages/AtRisk'))
const FollowUp = lazyPage(() => import('./pages/FollowUp'))
const BirthdayReminder = lazyPage(() => import('./pages/BirthdayReminder'))
const CampaignsCountryTiered = lazyPage(() => import('./pages/CampaignsCountryTiered'))
const Upgrades = lazyPage(() => import('./pages/Upgrades'))
const TransferTracker = lazyPage(() => import('./pages/TransferTracker'))
const BudgetStrategy = lazyPage(() => import('./pages/BudgetStrategy'))
const Analytics = lazyPage(() => import('./pages/Analytics'))
const KPIProgress = lazyPage(() => import('./pages/KPIProgress'))
const PeriodReport = lazyPage(() => import('./pages/PeriodReport'))
const TierAnalytics = lazyPage(() => import('./pages/TierAnalytics'))
const PlayerProfiling = lazyPage(() => import('./pages/PlayerProfiling'))
const AskData = lazyPage(() => import('./pages/AskData'))
const ManageUsers = lazyPage(() => import('./pages/ManageUsers'))
const CSVImport = lazyPage(() => import('./pages/CSVImport'))
const ExportPage = lazyPage(() => import('./pages/ExportPage'))
const ExpenseTracker = lazyPage(() => import('./pages/ExpenseTracker'))
const BossView = lazyPage(() => import('./pages/BossView'))
const ContactLog = lazyPage(() => import('./pages/ContactLog'))
const DailyTargets = lazyPage(() => import('./pages/DailyTargets'))
const ChurnAlerts = lazyPage(() => import('./pages/ChurnAlerts'))
const RetentionWorkspace = lazyPage(() => import('./pages/RetentionWorkspace'))
const RetentionAnalytics = lazyPage(() => import('./pages/RetentionAnalytics'))
const RetentionQueue = lazyPage(() => import('./pages/RetentionQueue'))
const MonthlyReportExport = lazyPage(() => import('./pages/MonthlyReportExport'))
const HostPerformance = lazyPage(() => import('./pages/HostPerformance'))
const ActiveTracker = lazyPage(() => import('./pages/ActiveTracker'))
const WeeklyOutcome = lazyPage(() => import('./pages/WeeklyOutcome'))
const LuckySpinAdmin = lazyPage(() => import('./pages/LuckySpinAdmin'))
const WANumbers = lazyPage(() => import('./pages/WANumbers'))
import './pages/RetentionAnalytics.css'

export default function App() {
  return <AuthProvider><LanguageProvider><BrowserRouter><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<Layout />}>
      <Route index element={<Navigate to="/today" replace />} />
      <Route path="dashboard" element={<Navigate to="/today" replace />} />

      {/* Command Center */}
      <Route path="today"    element={<RequireRole permKey="today"><Today /></RequireRole>} />
      <Route path="tasks"    element={<RequireRole permKey="tasks"><MyTasks /></RequireRole>} />
      <Route path="alerts"   element={<RequireRole permKey="alerts"><Alerts /></RequireRole>} />
      <Route path="targets"  element={<RequireRole permKey="targets"><DailyTargets /></RequireRole>} />

      {/* VIP Operations */}
      <Route path="vips"          element={<RequireRole permKey="vips"><AllVIPs /></RequireRole>} />
      <Route path="segments"      element={<RequireRole permKey="segments"><Segments /></RequireRole>} />
      <Route path="vips/:id"      element={<RequireRole permKey="vips"><VIP360 /></RequireRole>} />
      <Route path="vip360"        element={<RequireRole permKey="vips"><VIP360 /></RequireRole>} />{/* /vip360?player=<username>&tab=<tab> */}
      <Route path="at-risk"       element={<RequireRole permKey="at-risk"><AtRisk /></RequireRole>} />
      <Route path="active-tracker" element={<RequireRole permKey="active-tracker"><ActiveTracker /></RequireRole>} />
      <Route path="follow-up"     element={<RequireRole permKey="follow-up"><FollowUp /></RequireRole>} />
      <Route path="birthdays"     element={<RequireRole permKey="birthdays"><BirthdayReminder /></RequireRole>} />
      <Route path="upgrades"      element={<RequireRole permKey="upgrades"><Upgrades /></RequireRole>} />
      <Route path="transfer"      element={<RequireRole permKey="transfer"><TransferTracker /></RequireRole>} />

      {/* Retention */}
      <Route path="retention"           element={<RequireRole permKey="retention"><RetentionWorkspace /></RequireRole>} />
      <Route path="retention-queue"     element={<RequireRole permKey="retention-queue"><RetentionQueue /></RequireRole>} />
      <Route path="churn"               element={<RequireRole permKey="churn"><ChurnAlerts /></RequireRole>} />
      <Route path="contacts"            element={<RequireRole permKey="contacts"><ContactLog /></RequireRole>} />
      <Route path="weekly-outcome"      element={<RequireRole permKey="weekly-outcome"><WeeklyOutcome /></RequireRole>} />
      <Route path="retention-analytics" element={<RequireRole permKey="retention-analytics"><RetentionAnalytics /></RequireRole>} />

      {/* Campaigns */}
      <Route path="campaigns"        element={<RequireRole permKey="campaigns"><CampaignsCountryTiered /></RequireRole>} />
      <Route path="lucky-spin-admin" element={<RequireRole permKey="lucky-spin"><LuckySpinAdmin /></RequireRole>} />
      <Route path="budget"           element={<RequireRole permKey="budget"><BudgetStrategy /></RequireRole>} />

      {/* Analytics */}
      <Route path="analytics"      element={<RequireRole permKey="analytics"><Analytics /></RequireRole>} />
      <Route path="tier-analytics" element={<RequireRole permKey="tier-analytics"><TierAnalytics /></RequireRole>} />
      <Route path="profiling"      element={<RequireRole permKey="profiling"><PlayerProfiling /></RequireRole>} />
      <Route path="period-report"  element={<RequireRole permKey="period-report"><PeriodReport /></RequireRole>} />
      <Route path="monthly-report" element={<RequireRole permKey="monthly-report"><MonthlyReportExport /></RequireRole>} />

      {/* Performance */}
      <Route path="kpi"              element={<RequireRole permKey="kpi"><KPIProgress /></RequireRole>} />
      <Route path="host-performance" element={<RequireRole permKey="host-performance"><HostPerformance /></RequireRole>} />
      <Route path="manager-kpi"      element={<RequireRole permKey="manager-kpi"><ManagerKPI /></RequireRole>} />
      <Route path="exec"             element={<RequireRole permKey="exec"><ExecOverview /></RequireRole>} />
      <Route path="ask"              element={<RequireRole permKey="ask"><AskData /></RequireRole>} />

      {/* System */}
      <Route path="wa-numbers" element={<RequireRole permKey="wa-numbers"><WANumbers /></RequireRole>} />
      <Route path="users"      element={<RequireRole permKey="users"><ManageUsers /></RequireRole>} />
      <Route path="import"     element={<RequireRole permKey="import"><CSVImport /></RequireRole>} />
      <Route path="export"     element={<RequireRole permKey="export"><ExportPage /></RequireRole>} />
      <Route path="expenses"   element={<RequireRole permKey="expenses"><ExpenseTracker /></RequireRole>} />
      <Route path="boss"       element={<RequireRole permKey="boss"><BossView /></RequireRole>} />
    </Route>
    <Route path="*" element={<Navigate to="/today" replace />} />
  </Routes></BrowserRouter></LanguageProvider></AuthProvider>
}
