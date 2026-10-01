// src/App.jsx — V3 routing with permKey-based access control
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }      from './hooks/useAuth'
import { LanguageProvider }  from './contexts/LanguageContext'
import Layout                from './components/Layout'
import RequireRole           from './components/RequireRole'
import Login                 from './pages/Login'
import Today                 from './pages/Today'
import MyTasks               from './pages/MyTasks'
import Alerts                from './pages/Alerts'
import AllVIPs               from './pages/AllVIPs'
import VIP360                from './pages/VIP360'
import AtRisk                from './pages/AtRisk'
import FollowUp              from './pages/FollowUp'
import BirthdayReminder      from './pages/BirthdayReminder'
import CampaignsCountryTieredFixed from './pages/CampaignsCountryTieredFixed'
import Upgrades              from './pages/Upgrades'
import TransferTracker       from './pages/TransferTracker'
import BudgetStrategy        from './pages/BudgetStrategy'
import Analytics             from './pages/Analytics'
import KPIProgress           from './pages/KPIProgress'
import PeriodReport          from './pages/PeriodReport'
import TierAnalytics         from './pages/TierAnalytics'
import PlayerProfiling       from './pages/PlayerProfiling'
import AskData               from './pages/AskData'
import ManageUsers           from './pages/ManageUsers'
import CSVImport             from './pages/CSVImport'
import ExportPage            from './pages/ExportPage'
import ExpenseTracker        from './pages/ExpenseTracker'
import BossView              from './pages/BossView'
import ContactLog            from './pages/ContactLog'
import DailyTargets          from './pages/DailyTargets'
import ChurnAlerts           from './pages/ChurnAlerts'
import RetentionWorkspace    from './pages/RetentionWorkspace'
import RetentionAnalytics    from './pages/RetentionAnalytics'
import RetentionQueue        from './pages/RetentionQueue'
import MonthlyReportExport   from './pages/MonthlyReportExport'
import HostPerformance       from './pages/HostPerformance'
import ActiveTracker         from './pages/ActiveTracker'
import WeeklyOutcome         from './pages/WeeklyOutcome'
import LuckySpinAdmin        from './pages/LuckySpinAdmin'
import WANumbers             from './pages/WANumbers'
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
      <Route path="campaigns"        element={<RequireRole permKey="campaigns"><CampaignsCountryTieredFixed /></RequireRole>} />
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
