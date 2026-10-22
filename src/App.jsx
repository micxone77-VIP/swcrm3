// src/App.jsx — V3 routing with permKey-based access control
import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }      from './hooks/useAuth'
import { LanguageProvider }  from './contexts/LanguageContext'
import Layout                from './components/Layout'
import RequireRole           from './components/RequireRole'
import Login                 from './pages/Login'
// Pages load only when opened (keeps the first download small); Layout shows a loading line meanwhile.
const Today = lazy(() => import('./pages/Today'))
const MyTasks = lazy(() => import('./pages/MyTasks'))
const Alerts = lazy(() => import('./pages/Alerts'))
const AllVIPs = lazy(() => import('./pages/AllVIPs'))
const VIP360 = lazy(() => import('./pages/VIP360'))
const AtRisk = lazy(() => import('./pages/AtRisk'))
const FollowUp = lazy(() => import('./pages/FollowUp'))
const BirthdayReminder = lazy(() => import('./pages/BirthdayReminder'))
const CampaignsCountryTiered = lazy(() => import('./pages/CampaignsCountryTiered'))
const Upgrades = lazy(() => import('./pages/Upgrades'))
const TransferTracker = lazy(() => import('./pages/TransferTracker'))
const BudgetStrategy = lazy(() => import('./pages/BudgetStrategy'))
const Analytics = lazy(() => import('./pages/Analytics'))
const KPIProgress = lazy(() => import('./pages/KPIProgress'))
const PeriodReport = lazy(() => import('./pages/PeriodReport'))
const TierAnalytics = lazy(() => import('./pages/TierAnalytics'))
const PlayerProfiling = lazy(() => import('./pages/PlayerProfiling'))
const AskData = lazy(() => import('./pages/AskData'))
const ManageUsers = lazy(() => import('./pages/ManageUsers'))
const CSVImport = lazy(() => import('./pages/CSVImport'))
const ExportPage = lazy(() => import('./pages/ExportPage'))
const ExpenseTracker = lazy(() => import('./pages/ExpenseTracker'))
const BossView = lazy(() => import('./pages/BossView'))
const ContactLog = lazy(() => import('./pages/ContactLog'))
const DailyTargets = lazy(() => import('./pages/DailyTargets'))
const ChurnAlerts = lazy(() => import('./pages/ChurnAlerts'))
const RetentionWorkspace = lazy(() => import('./pages/RetentionWorkspace'))
const RetentionAnalytics = lazy(() => import('./pages/RetentionAnalytics'))
const RetentionQueue = lazy(() => import('./pages/RetentionQueue'))
const MonthlyReportExport = lazy(() => import('./pages/MonthlyReportExport'))
const HostPerformance = lazy(() => import('./pages/HostPerformance'))
const ActiveTracker = lazy(() => import('./pages/ActiveTracker'))
const WeeklyOutcome = lazy(() => import('./pages/WeeklyOutcome'))
const LuckySpinAdmin = lazy(() => import('./pages/LuckySpinAdmin'))
const WANumbers = lazy(() => import('./pages/WANumbers'))
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
