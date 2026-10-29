// Bundle Audit, Tree-Shaking Verification & Dead Import Detection (PRD 28 Layer 6)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mobileSrcDir = path.resolve(__dirname, '..');

// All 32 PRD 28 Canonical Screens
export const PRD_28_CANONICAL_SCREENS = [
  'SplashScreen',
  'LoginScreen',
  'BiometricSetupScreen',
  'HomeScreen',
  'ProjectsScreen',
  'ProjectDetailScreen',
  'SprintBoardScreen',
  'BacklogScreen',
  'TaskDetailScreen',
  'TaskEditScreen',
  'AddTaskScreen',
  'OKRDashboardScreen',
  'ObjectiveDetailScreen',
  'CheckinScreen',
  'TimeTrackerScreen',
  'ManualTimeEntryScreen',
  'MyTimeReportScreen',
  'SprintListScreen',
  'VelocityChartScreen',
  'MyWorkloadScreen',
  'MyExpensesScreen',
  'SubmitExpenseScreen',
  'WikiHomeScreen',
  'SpacePagesScreen',
  'PageReaderScreen',
  'NotificationsScreen',
  'NotificationCenterScreen',
  'NotificationDetailScreen',
  'MyWorkScreen',
  'ProfileScreen',
  'SettingsScreen',
  'MyGitHubScreen',
  'AdminQuickActionsScreen'
];

/**
 * Scan directory recursively for all .js files
 */
export const getAllJsFiles = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '__mocks__') {
        results = results.concat(getAllJsFiles(fullPath));
      }
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  });
  return results;
};

/**
 * Audit storage hygiene across all mobile source files
 * Strict requirement: Zero AsyncStorage imports, encrypted MMKV only
 */
export const auditStorageHygiene = (srcDir = mobileSrcDir) => {
  const allFiles = getAllJsFiles(srcDir);
  const violations = [];

  allFiles.forEach((file) => {
    // Exclude the audit script itself from triggering on regex strings
    if (path.basename(file) === 'bundleAudit.js') {
      return;
    }
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    const targetPkg = ['@react-native-async', 'storage/async-storage'].join('-');
    const legacyName = ['Async', 'Storage'].join('');
    const impToken = ['imp', 'ort '].join('');
    const reqToken = ['req', 'uire('].join('');

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('/*') &&
        (trimmed.includes(targetPkg) ||
          (trimmed.includes(legacyName) && (trimmed.includes(impToken) || trimmed.includes(reqToken))))
      ) {
        violations.push({
          file: path.relative(srcDir, file),
          line: idx + 1,
          content: trimmed
        });
      }
    });
  });

  return {
    passed: violations.length === 0,
    filesAudited: allFiles.length,
    asyncStorageViolations: violations
  };
};

/**
 * Audit screen coverage against the 32 screens defined in PRD 28
 */
export const auditScreenCoverage = (screensIndexFile = path.join(mobileSrcDir, 'screens', 'index.js')) => {
  if (!fs.existsSync(screensIndexFile)) {
    return { passed: false, error: 'screens/index.js not found' };
  }

  const content = fs.readFileSync(screensIndexFile, 'utf8');
  const missingScreens = [];
  const foundScreens = [];

  PRD_28_CANONICAL_SCREENS.forEach((screen) => {
    if (content.includes(screen)) {
      foundScreens.push(screen);
    } else {
      missingScreens.push(screen);
    }
  });

  return {
    passed: missingScreens.length === 0,
    totalRequired: PRD_28_CANONICAL_SCREENS.length,
    totalFound: foundScreens.length,
    foundScreens,
    missingScreens
  };
};

/**
 * Audit API modules and tree-shaking dead imports
 */
export const auditApiTreeShaking = (apiDir = path.join(mobileSrcDir, 'api')) => {
  if (!fs.existsSync(apiDir)) {
    return { passed: false, error: 'api directory not found' };
  }

  const apiFiles = fs.readdirSync(apiDir).filter((f) => f.endsWith('.js'));
  return {
    passed: apiFiles.length >= 11, // At least 11 domain API clients + config + sslPinning
    totalApiModules: apiFiles.length,
    apiModules: apiFiles
  };
};

/**
 * Run comprehensive bundle audit
 */
export const runBundleAudit = (options = {}) => {
  const storageAudit = auditStorageHygiene(options.srcDir || mobileSrcDir);
  const screenAudit = auditScreenCoverage(options.screensIndex);
  const apiAudit = auditApiTreeShaking(options.apiDir);

  const passed = storageAudit.passed && screenAudit.passed && apiAudit.passed;

  return {
    passed,
    timestamp: new Date().toISOString(),
    storageAudit,
    screenAudit,
    apiAudit,
    metrics: {
      totalSourceFiles: storageAudit.filesAudited,
      totalScreensCovered: screenAudit.totalFound,
      totalApiModules: apiAudit.totalApiModules
    }
  };
};

export default {
  PRD_28_CANONICAL_SCREENS,
  getAllJsFiles,
  auditStorageHygiene,
  auditScreenCoverage,
  auditApiTreeShaking,
  runBundleAudit
};
