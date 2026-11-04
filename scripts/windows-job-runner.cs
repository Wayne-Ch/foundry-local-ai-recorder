using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace AiRecorder.Probes
{
    public sealed class ProcessIdentity
    {
        public int ProcessId { get; set; }
        public string CreationKey { get; set; }
    }

    public sealed class JobRunResult
    {
        public string Kind { get; set; }
        public int? ExitCode { get; set; }
        public int RootProcessId { get; set; }
        public int[] ProcessIds { get; set; }
        public ProcessIdentity[] OwnedIdentities { get; set; }
        public bool CleanupSucceeded { get; set; }
        public string Message { get; set; }
    }

    public static class WindowsJobRunner
    {
        private const uint CreateSuspended = 0x00000004;
        private const uint CreateNoWindow = 0x08000000;
        private const uint StartfUseStdHandles = 0x00000100;
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private const uint WaitObject0 = 0x00000000;
        private const uint WaitTimeout = 0x00000102;
        private const uint Infinite = 0xffffffff;
        private const uint HandleFlagInherit = 0x00000001;
        private const uint GenericRead = 0x80000000;
        private const uint FileShareRead = 0x00000001;
        private const uint FileShareWrite = 0x00000002;
        private const uint OpenExisting = 3;
        private const uint FileAttributeNormal = 0x00000080;
        private const uint ProcessQueryLimitedInformation = 0x1000;
        private const int ErrorMoreData = 234;
        private const int JobObjectBasicAccountingInformation = 1;
        private const int JobObjectBasicProcessIdList = 3;
        private const int JobObjectExtendedLimitInformation = 9;

        public static JobRunResult Run(
            string command,
            string[] arguments,
            string workingDirectory,
            int timeoutMs,
            int descendantExitTimeoutMs,
            int pollIntervalMs,
            int cleanupTimeoutMs)
        {
            IntPtr jobHandle = IntPtr.Zero;
            IntPtr processHandle = IntPtr.Zero;
            IntPtr threadHandle = IntPtr.Zero;
            IntPtr stdoutReadHandle = IntPtr.Zero;
            IntPtr stdoutWriteHandle = IntPtr.Zero;
            IntPtr stderrReadHandle = IntPtr.Zero;
            IntPtr stderrWriteHandle = IntPtr.Zero;
            IntPtr nullInputHandle = IntPtr.Zero;
            FileStream stdoutReader = null;
            FileStream stderrReader = null;
            Task stdoutPump = null;
            Task stderrPump = null;
            JobRunResult result = null;

            try
            {
                jobHandle = CreateJobObject(IntPtr.Zero, null);
                ThrowIfInvalidHandle(jobHandle, "CreateJobObject");
                ConfigureKillOnClose(jobHandle);

                CreateOutputPipe(out stdoutReadHandle, out stdoutWriteHandle);
                CreateOutputPipe(out stderrReadHandle, out stderrWriteHandle);
                SECURITY_ATTRIBUTES inputAttributes = new SECURITY_ATTRIBUTES();
                inputAttributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
                inputAttributes.bInheritHandle = true;
                nullInputHandle = CreateFile(
                    "NUL",
                    GenericRead,
                    FileShareRead | FileShareWrite,
                    ref inputAttributes,
                    OpenExisting,
                    FileAttributeNormal,
                    IntPtr.Zero);
                ThrowIfInvalidHandle(nullInputHandle, "CreateFile(NUL)");

                STARTUPINFO startupInfo = new STARTUPINFO();
                startupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                startupInfo.dwFlags = StartfUseStdHandles;
                startupInfo.hStdInput = nullInputHandle;
                startupInfo.hStdOutput = stdoutWriteHandle;
                startupInfo.hStdError = stderrWriteHandle;

                PROCESS_INFORMATION processInformation;
                StringBuilder commandLine = new StringBuilder(BuildCommandLine(command, arguments));
                bool created = CreateProcess(
                    command,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CreateSuspended | CreateNoWindow,
                    IntPtr.Zero,
                    workingDirectory,
                    ref startupInfo,
                    out processInformation);
                if (!created)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess failed.");
                }

                processHandle = processInformation.hProcess;
                threadHandle = processInformation.hThread;
                int rootProcessId = checked((int)processInformation.dwProcessId);
                ProcessIdentity rootIdentity = ReadProcessIdentity(processHandle, rootProcessId);

                stdoutReader = CreatePipeReader(stdoutReadHandle);
                stdoutReadHandle = IntPtr.Zero;
                stderrReader = CreatePipeReader(stderrReadHandle);
                stderrReadHandle = IntPtr.Zero;
                CloseOwnedHandle(ref stdoutWriteHandle);
                CloseOwnedHandle(ref stderrWriteHandle);
                CloseOwnedHandle(ref nullInputHandle);
                stdoutPump = PumpOutput(stdoutReader, Console.OpenStandardOutput());
                stderrPump = PumpOutput(stderrReader, Console.OpenStandardError());

                if (!AssignProcessToJobObject(jobHandle, processHandle))
                {
                    int error = Marshal.GetLastWin32Error();
                    TerminateProcess(processHandle, 1);
                    WaitForSingleObject(processHandle, Infinite);
                    throw new Win32Exception(error, "AssignProcessToJobObject failed.");
                }

                uint resumeResult = ResumeThread(threadHandle);
                if (resumeResult == uint.MaxValue)
                {
                    int error = Marshal.GetLastWin32Error();
                    TerminateJobObject(jobHandle, 1);
                    WaitForJobToEmpty(jobHandle, cleanupTimeoutMs, pollIntervalMs);
                    throw new Win32Exception(error, "ResumeThread failed.");
                }
                CloseOwnedHandle(ref threadHandle);

                uint waitResult = WaitForSingleObject(processHandle, checked((uint)timeoutMs));
                if (waitResult == WaitTimeout)
                {
                    ProcessIdentity[] identities = ReadJobProcessIdentities(jobHandle, rootIdentity);
                    int[] processIds = ReadJobProcessIds(jobHandle);
                    bool cleanupSucceeded = TerminateJobAndWait(
                        jobHandle,
                        cleanupTimeoutMs,
                        pollIntervalMs);
                    result = new JobRunResult
                    {
                        Kind = "timeout",
                        ExitCode = null,
                        RootProcessId = rootProcessId,
                        ProcessIds = processIds,
                        OwnedIdentities = identities,
                        CleanupSucceeded = cleanupSucceeded,
                        Message = null,
                    };
                }
                else if (waitResult == WaitObject0)
                {
                    uint rawExitCode;
                    if (!GetExitCodeProcess(processHandle, out rawExitCode))
                    {
                        throw new Win32Exception(
                            Marshal.GetLastWin32Error(),
                            "GetExitCodeProcess failed.");
                    }

                    bool descendantsExited = WaitForJobToEmpty(
                        jobHandle,
                        descendantExitTimeoutMs,
                        pollIntervalMs);
                    if (descendantsExited)
                    {
                        result = new JobRunResult
                        {
                            Kind = "exit",
                            ExitCode = unchecked((int)rawExitCode),
                            RootProcessId = rootProcessId,
                            ProcessIds = new int[0],
                            OwnedIdentities = new ProcessIdentity[0],
                            CleanupSucceeded = true,
                            Message = null,
                        };
                    }
                    else
                    {
                        ProcessIdentity[] identities = ReadJobProcessIdentities(
                            jobHandle,
                            rootIdentity);
                        int[] processIds = ReadJobProcessIds(jobHandle);
                        bool cleanupSucceeded = TerminateJobAndWait(
                            jobHandle,
                            cleanupTimeoutMs,
                            pollIntervalMs);
                        result = new JobRunResult
                        {
                            Kind = "leak",
                            ExitCode = unchecked((int)rawExitCode),
                            RootProcessId = rootProcessId,
                            ProcessIds = processIds,
                            OwnedIdentities = identities,
                            CleanupSucceeded = cleanupSucceeded,
                            Message = null,
                        };
                    }
                }
                else
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "WaitForSingleObject failed.");
                }
            }
            catch (Exception error)
            {
                ProcessIdentity[] identities = jobHandle == IntPtr.Zero
                    ? new ProcessIdentity[0]
                    : ReadJobProcessIdentities(jobHandle, null);
                int[] processIds = jobHandle == IntPtr.Zero
                    ? new int[0]
                    : TryReadJobProcessIds(jobHandle);
                bool cleanupSucceeded = jobHandle == IntPtr.Zero
                    || TerminateJobAndWait(jobHandle, cleanupTimeoutMs, pollIntervalMs);
                result = new JobRunResult
                {
                    Kind = "error",
                    ExitCode = null,
                    RootProcessId = 0,
                    ProcessIds = processIds,
                    OwnedIdentities = identities,
                    CleanupSucceeded = cleanupSucceeded,
                    Message = error.ToString(),
                };
            }
            finally
            {
                CloseOwnedHandle(ref stdoutWriteHandle);
                CloseOwnedHandle(ref stderrWriteHandle);
                CloseOwnedHandle(ref nullInputHandle);
                CloseOwnedHandle(ref threadHandle);
                CloseOwnedHandle(ref processHandle);
                CloseOwnedHandle(ref jobHandle);
                string pumpFailure = WaitForPumps(stdoutPump, stderrPump, cleanupTimeoutMs);
                if (pumpFailure != null)
                {
                    result.Kind = "error";
                    result.Message = pumpFailure;
                }
                if (stdoutReader != null)
                {
                    stdoutReader.Dispose();
                }
                if (stderrReader != null)
                {
                    stderrReader.Dispose();
                }
                CloseOwnedHandle(ref stdoutReadHandle);
                CloseOwnedHandle(ref stderrReadHandle);
            }

            return result;
        }

        private static void ConfigureKillOnClose(IntPtr jobHandle)
        {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION information =
                new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            information.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(information, buffer, false);
                if (!SetInformationJobObject(
                    jobHandle,
                    JobObjectExtendedLimitInformation,
                    buffer,
                    checked((uint)size)))
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "SetInformationJobObject failed.");
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static void CreateOutputPipe(out IntPtr readHandle, out IntPtr writeHandle)
        {
            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
            attributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            attributes.bInheritHandle = true;
            if (!CreatePipe(out readHandle, out writeHandle, ref attributes, 0))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreatePipe failed.");
            }
            if (!SetHandleInformation(readHandle, HandleFlagInherit, 0))
            {
                int error = Marshal.GetLastWin32Error();
                CloseHandle(readHandle);
                CloseHandle(writeHandle);
                readHandle = IntPtr.Zero;
                writeHandle = IntPtr.Zero;
                throw new Win32Exception(error, "SetHandleInformation failed.");
            }
        }

        private static FileStream CreatePipeReader(IntPtr readHandle)
        {
            SafeFileHandle safeHandle = new SafeFileHandle(readHandle, true);
            return new FileStream(safeHandle, FileAccess.Read, 4096, false);
        }

        private static Task PumpOutput(Stream input, Stream output)
        {
            return Task.Run(delegate
            {
                input.CopyTo(output);
                output.Flush();
            });
        }

        private static string WaitForPumps(Task stdoutPump, Task stderrPump, int timeoutMs)
        {
            List<Task> pumps = new List<Task>();
            if (stdoutPump != null)
            {
                pumps.Add(stdoutPump);
            }
            if (stderrPump != null)
            {
                pumps.Add(stderrPump);
            }
            if (pumps.Count == 0)
            {
                return null;
            }
            try
            {
                if (!Task.WaitAll(pumps.ToArray(), Math.Max(1, timeoutMs)))
                {
                    return "Timed out while draining owned process output.";
                }
            }
            catch (AggregateException error)
            {
                return "Failed while draining owned process output: "
                    + error.Flatten().ToString();
            }
            return null;
        }

        private static bool WaitForJobToEmpty(IntPtr jobHandle, int timeoutMs, int pollIntervalMs)
        {
            Stopwatch stopwatch = Stopwatch.StartNew();
            while (ReadActiveProcessCount(jobHandle) > 0)
            {
                if (stopwatch.ElapsedMilliseconds >= timeoutMs)
                {
                    return false;
                }
                Thread.Sleep(Math.Max(1, pollIntervalMs));
            }
            return true;
        }

        private static bool TerminateJobAndWait(
            IntPtr jobHandle,
            int timeoutMs,
            int pollIntervalMs)
        {
            try
            {
                if (ReadActiveProcessCount(jobHandle) > 0
                    && !TerminateJobObject(jobHandle, 1))
                {
                    return false;
                }
                return WaitForJobToEmpty(jobHandle, timeoutMs, pollIntervalMs);
            }
            catch (Win32Exception)
            {
                return false;
            }
        }

        private static uint ReadActiveProcessCount(IntPtr jobHandle)
        {
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information =
                new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
            int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                uint returnedLength;
                if (!QueryInformationJobObject(
                    jobHandle,
                    JobObjectBasicAccountingInformation,
                    buffer,
                    checked((uint)size),
                    out returnedLength))
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "QueryInformationJobObject accounting failed.");
                }
                information = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
                    buffer,
                    typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
                return information.ActiveProcesses;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static int[] ReadJobProcessIds(IntPtr jobHandle)
        {
            int capacity = 32;
            while (true)
            {
                int size = checked(8 + (capacity * IntPtr.Size));
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    uint returnedLength;
                    bool succeeded = QueryInformationJobObject(
                        jobHandle,
                        JobObjectBasicProcessIdList,
                        buffer,
                        checked((uint)size),
                        out returnedLength);
                    int assignedCount = Marshal.ReadInt32(buffer, 0);
                    int listedCount = Marshal.ReadInt32(buffer, 4);
                    if (succeeded)
                    {
                        int[] processIds = new int[listedCount];
                        for (int index = 0; index < listedCount; index += 1)
                        {
                            long rawProcessId = IntPtr.Size == 8
                                ? Marshal.ReadInt64(buffer, 8 + (index * IntPtr.Size))
                                : Marshal.ReadInt32(buffer, 8 + (index * IntPtr.Size));
                            processIds[index] = checked((int)rawProcessId);
                        }
                        return processIds;
                    }

                    int error = Marshal.GetLastWin32Error();
                    if (error != ErrorMoreData)
                    {
                        throw new Win32Exception(
                            error,
                            "QueryInformationJobObject process list failed.");
                    }
                    capacity = Math.Max(capacity * 2, Math.Max(assignedCount, listedCount) + 8);
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
        }

        private static ProcessIdentity[] ReadJobProcessIdentities(
            IntPtr jobHandle,
            ProcessIdentity rootIdentity)
        {
            try
            {
                int[] processIds = ReadJobProcessIds(jobHandle);
                List<ProcessIdentity> identities = new List<ProcessIdentity>();
                for (int index = 0; index < processIds.Length; index += 1)
                {
                    ProcessIdentity identity = ReadProcessIdentity(processIds[index]);
                    if (identity != null)
                    {
                        identities.Add(identity);
                    }
                }
                if (rootIdentity != null && !ContainsIdentity(identities, rootIdentity))
                {
                    identities.Add(rootIdentity);
                }
                return identities.ToArray();
            }
            catch (Win32Exception)
            {
                return rootIdentity == null
                    ? new ProcessIdentity[0]
                    : new[] { rootIdentity };
            }
        }

        private static int[] TryReadJobProcessIds(IntPtr jobHandle)
        {
            try
            {
                return ReadJobProcessIds(jobHandle);
            }
            catch (Win32Exception)
            {
                return new int[0];
            }
        }

        private static bool ContainsIdentity(
            List<ProcessIdentity> identities,
            ProcessIdentity candidate)
        {
            for (int index = 0; index < identities.Count; index += 1)
            {
                ProcessIdentity identity = identities[index];
                if (identity.ProcessId == candidate.ProcessId
                    && String.Equals(
                        identity.CreationKey,
                        candidate.CreationKey,
                        StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private static ProcessIdentity ReadProcessIdentity(int processId)
        {
            IntPtr processHandle = OpenProcess(
                ProcessQueryLimitedInformation,
                false,
                checked((uint)processId));
            if (processHandle == IntPtr.Zero)
            {
                return null;
            }
            try
            {
                return ReadProcessIdentity(processHandle, processId);
            }
            finally
            {
                CloseHandle(processHandle);
            }
        }

        private static ProcessIdentity ReadProcessIdentity(IntPtr processHandle, int processId)
        {
            FILETIME creationTime;
            FILETIME exitTime;
            FILETIME kernelTime;
            FILETIME userTime;
            if (!GetProcessTimes(
                processHandle,
                out creationTime,
                out exitTime,
                out kernelTime,
                out userTime))
            {
                return null;
            }
            long creationValue =
                ((long)creationTime.dwHighDateTime << 32) | creationTime.dwLowDateTime;
            creationValue -= creationValue % 10;
            return new ProcessIdentity
            {
                ProcessId = processId,
                CreationKey = processId.ToString() + ":" + creationValue.ToString(),
            };
        }

        private static string BuildCommandLine(string command, string[] arguments)
        {
            StringBuilder commandLine = new StringBuilder(QuoteArgument(command));
            string[] safeArguments = arguments ?? new string[0];
            for (int index = 0; index < safeArguments.Length; index += 1)
            {
                commandLine.Append(' ');
                commandLine.Append(QuoteArgument(safeArguments[index] ?? String.Empty));
            }
            return commandLine.ToString();
        }

        private static string QuoteArgument(string value)
        {
            if (value.Length == 0)
            {
                return "\"\"";
            }
            bool needsQuotes = false;
            for (int index = 0; index < value.Length; index += 1)
            {
                char character = value[index];
                if (Char.IsWhiteSpace(character) || character == '"')
                {
                    needsQuotes = true;
                    break;
                }
            }
            if (!needsQuotes)
            {
                return value;
            }

            StringBuilder quoted = new StringBuilder();
            quoted.Append('"');
            int backslashCount = 0;
            for (int index = 0; index < value.Length; index += 1)
            {
                char character = value[index];
                if (character == '\\')
                {
                    backslashCount += 1;
                    continue;
                }
                if (character == '"')
                {
                    quoted.Append('\\', (backslashCount * 2) + 1);
                    quoted.Append('"');
                    backslashCount = 0;
                    continue;
                }
                quoted.Append('\\', backslashCount);
                quoted.Append(character);
                backslashCount = 0;
            }
            quoted.Append('\\', backslashCount * 2);
            quoted.Append('"');
            return quoted.ToString();
        }

        private static void ThrowIfInvalidHandle(IntPtr handle, string operation)
        {
            if (handle == IntPtr.Zero || handle == new IntPtr(-1))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed.");
            }
        }

        private static void CloseOwnedHandle(ref IntPtr handle)
        {
            if (handle == IntPtr.Zero || handle == new IntPtr(-1))
            {
                handle = IntPtr.Zero;
                return;
            }
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)]
            public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public uint dwX;
            public uint dwY;
            public uint dwXSize;
            public uint dwYSize;
            public uint dwXCountChars;
            public uint dwYCountChars;
            public uint dwFillAttribute;
            public uint dwFlags;
            public ushort wShowWindow;
            public ushort cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        {
            public long TotalUserTime;
            public long TotalKernelTime;
            public long ThisPeriodTotalUserTime;
            public long ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount;
            public uint TotalProcesses;
            public uint ActiveProcesses;
            public uint TotalTerminatedProcesses;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILETIME
        {
            public uint dwLowDateTime;
            public uint dwHighDateTime;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(
            IntPtr jobAttributes,
            string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(
            IntPtr job,
            int informationClass,
            IntPtr information,
            uint informationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool QueryInformationJobObject(
            IntPtr job,
            int informationClass,
            IntPtr information,
            uint informationLength,
            out uint returnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(
            IntPtr job,
            IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(
            IntPtr job,
            uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreatePipe(
            out IntPtr readPipe,
            out IntPtr writePipe,
            ref SECURITY_ATTRIBUTES pipeAttributes,
            uint size);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetHandleInformation(
            IntPtr handle,
            uint mask,
            uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFile(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            ref SECURITY_ATTRIBUTES securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcess(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(
            IntPtr handle,
            uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(
            IntPtr process,
            out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateProcess(
            IntPtr process,
            uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(
            uint desiredAccess,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
            uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetProcessTimes(
            IntPtr process,
            out FILETIME creationTime,
            out FILETIME exitTime,
            out FILETIME kernelTime,
            out FILETIME userTime);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);
    }
}
