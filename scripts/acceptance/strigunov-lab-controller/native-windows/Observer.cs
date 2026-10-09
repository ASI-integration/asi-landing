// Read-only diagnostic collector. No service, listener, credentials or authorization.
// A future service must compile/pin/sign this source in an independently protected binary.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Asi.Strigunov.NativeWindows {
  public sealed class PathObservation {
    public string status = "HOST_AUTHN_UNAVAILABLE";
    public string reason = "OS_EVIDENCE_DENIED";
    public int handlesObserved;
    public string fileId = "";
    public string pathDigest = "";
    public string executableSha256 = "";
    public string aclDigest = "";
    public bool identitiesStable;
    public bool conservativeAclSafe;
    public bool effectiveAccessProven = false;
    public bool executionAuthorized = false;
  }
  public sealed class ProcessObservation {
    public string schemaVersion = "asi.windows.diagnostic.v1";
    public string state = "DIAGNOSTIC_ONLY";
    public string reason = "HOST_NOT_PROVISIONED";
    public bool executionAuthorized = false;
    public bool tokenObserved;
    public bool identityStable;
    public int pid;
    public int parentPid;
    public int sessionId;
    public string userSid = "";
    public string integritySid = "";
    public string authenticationId = "";
    public bool elevated;
    public string startFileTime = "";
    public string uptimeMilliseconds = "";
    public string bootIdentityStatus = "UNAVAILABLE";
    public string bootTimeFileTime = "";
    public bool bootTimeStable;
    public int matchingServiceCount = -1;
    public string serviceStatus = "NOT_INSTALLED";
    public string pipeStatus = "NOT_INSTALLED";
    public PathObservation executable = new PathObservation();
  }
  public static class Observer {
    [StructLayout(LayoutKind.Sequential)] struct FileInfo {
      public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry {
      public uint Size, Usage, Pid; public UIntPtr DefaultHeap; public uint Module, Threads, Parent;
      public int Priority; public uint Flags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Exe;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(SafeFileHandle t, int kind, IntPtr b, int size, out int needed);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr p, uint flags, StringBuilder b, ref uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string p, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out FileInfo info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h, StringBuilder p, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(SafeFileHandle h, byte[] b, uint size, out uint read, IntPtr overlapped);
    [DllImport("advapi32.dll", SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle h, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
    [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
    [DllImport("kernel32.dll", SetLastError=true)] static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32First(SafeFileHandle h, ref ProcessEntry e);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32Next(SafeFileHandle h, ref ProcessEntry e);
    static void Need(bool value) { if (!value) throw new Win32Exception(); }
    static string Hex(byte[] b) { return BitConverter.ToString(b).Replace("-","").ToLowerInvariant(); }
    static string Hash(string text) { using (var h=SHA256.Create()) return Hex(h.ComputeHash(Encoding.UTF8.GetBytes(text))); }
    static string Id(FileInfo i) { return i.Volume.ToString("x8")+i.IndexHigh.ToString("x8")+i.IndexLow.ToString("x8"); }
    static string TokenSid(SafeFileHandle t, int kind) {
      return TokenValue(t, kind, delegate(IntPtr p) { return new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value; });
    }
    static string TokenValue(SafeFileHandle t, int kind, Func<IntPtr,string> read) {
      int size=0; GetTokenInformation(t,kind,IntPtr.Zero,0,out size);
      Need(size>0 && size<=65536); IntPtr p=Marshal.AllocHGlobal(size);
      try { int actual; Need(GetTokenInformation(t,kind,p,size,out actual) && actual<=size); return read(p); }
      finally { Marshal.FreeHGlobal(p); }
    }
    static string BootTime() {
      using(var q=new ManagementObjectSearcher("SELECT LastBootUpTime FROM Win32_OperatingSystem")) {
        q.Options.Timeout=TimeSpan.FromSeconds(3);
        using(var values=q.Get()) {
          string value=null; int count=0;
          foreach(ManagementObject item in values) using(item) {
            Need(++count==1); value=ManagementDateTimeConverter.ToDateTime((string)item["LastBootUpTime"]).ToUniversalTime().ToFileTimeUtc().ToString();
          }
          Need(value!=null); return value;
        }
      }
    }
    static int ServiceCount(int pid) {
      using(var q=new ManagementObjectSearcher("SELECT ProcessId FROM Win32_Service WHERE ProcessId = "+pid.ToString(System.Globalization.CultureInfo.InvariantCulture))) {
        q.Options.Timeout=TimeSpan.FromSeconds(3);
        using(var values=q.Get()) return values.Count;
      }
    }
    static int Parent(int pid) {
      using(var h=CreateToolhelp32Snapshot(2,0)) {
        Need(!h.IsInvalid); var e=new ProcessEntry(); e.Size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
        Need(Process32First(h,ref e)); int count=0;
        do { if(e.Pid==pid) return checked((int)e.Parent); Need(++count<65536); }
        while(Process32Next(h,ref e));
      }
      throw new InvalidOperationException();
    }
    static bool TrustedOwner(string sid) {
      return sid=="S-1-5-18" || sid=="S-1-5-32-544" ||
        sid=="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    }
    // Conservative ACE screening is NOT AccessCheck/Authz effective access proof.
    // Deny unsupported/object/callback ACEs and any dangerous allow outside trusted owners.
    static string Security(SafeFileHandle h, out bool safe) {
      IntPtr o,g,d,s,sd; uint error=GetSecurityInfo(h,1,5,out o,out g,out d,out s,out sd);
      Need(error==0 && sd!=IntPtr.Zero);
      try {
        uint n=GetSecurityDescriptorLength(sd); Need(n>0 && n<=65536);
        byte[] bytes=new byte[n]; Marshal.Copy(sd,bytes,0,bytes.Length);
        var descriptor=new RawSecurityDescriptor(bytes,0);
        safe=descriptor.Owner!=null && TrustedOwner(descriptor.Owner.Value) && descriptor.DiscretionaryAcl!=null;
        if(descriptor.DiscretionaryAcl!=null) foreach(GenericAce raw in descriptor.DiscretionaryAcl) {
          var ace=raw as CommonAce;
          if(ace==null || ace.IsCallback) { safe=false; continue; }
          if((ace.AceFlags & AceFlags.InheritOnly)!=0) continue;
          uint mask=unchecked((uint)ace.AccessMask);
          const uint dangerous=0x40000000u|0x10000000u|0x00010000u|0x00040000u|0x00080000u|0x00000100u|0x00000040u|0x00000010u|0x00000004u|0x00000002u;
          if(ace.AceQualifier==AceQualifier.AccessAllowed && (mask & dangerous)!=0 &&
             !TrustedOwner(ace.SecurityIdentifier.Value)) safe=false;
        }
        using(var sha=SHA256.Create()) return Hex(sha.ComputeHash(bytes));
      } finally { LocalFree(sd); }
    }
    static string StrictPath(string input) {
      if(input==null || input.Length<4 || input.Length>1024 || !Char.IsLetter(input[0]) ||
         input[1]!=':' || input[2]!='\\' || input.IndexOf(':',2)>=0 || input.Contains("/") ||
         input.IndexOfAny(new char[]{'*','?','\0'})>=0) throw new InvalidOperationException();
      string full=Path.GetFullPath(input);
      if(!String.Equals(full,input,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException();
      foreach(string part in input.Substring(3).Split('\\'))
        if(part.Length==0 || part.EndsWith(".") || part.EndsWith(" ") || part==".." || part==".")
          throw new InvalidOperationException();
      return full;
    }
    public static PathObservation ObservePath(string input) {
      var result=new PathObservation(); var handles=new List<SafeFileHandle>(); var ids=new List<string>();
      var paths=new List<string>(); var securities=new List<string>();
      try {
        string full=StrictPath(input), current=full; result.pathDigest=Hash(full.ToUpperInvariant());
        while(current!=null) {
          paths.Add(current); Need(paths.Count<=32);
          var parent=Directory.GetParent(current); current=parent==null?null:parent.FullName;
        }
        paths.Reverse(); bool allSafe=true;
        for(int index=0;index<paths.Count;index++) {
          bool leaf=index==paths.Count-1;
          // READ_CONTROL + FILE_READ_ATTRIBUTES (+ FILE_READ_DATA for leaf); deny sharing write/delete.
          var handle=CreateFile(paths[index],leaf?0x20081u:0x20080u,1,IntPtr.Zero,3,0x02200000u,IntPtr.Zero);
          if(handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(); }
          handles.Add(handle); result.handlesObserved=handles.Count;
          FileInfo info; Need(GetFileInformationByHandle(handle,out info));
          Need((info.Attributes & 0x400)==0 && (!leaf || (info.Attributes & 0x10)==0));
          if(leaf) Need(info.Links==1 && info.SizeHigh==0 && info.SizeLow<=67108864);
          var finalPath=new StringBuilder(2048); uint n=GetFinalPathNameByHandle(handle,finalPath,2048,0);
          Need(n>0 && n<2048 && String.Equals(finalPath.ToString(),"\\\\?\\"+paths[index],StringComparison.OrdinalIgnoreCase));
          bool safe; securities.Add(Security(handle,out safe)); allSafe &= safe; ids.Add(Id(info));
        }
        result.fileId=ids[ids.Count-1]; result.conservativeAclSafe=allSafe;
        result.aclDigest=Hash(String.Join("|",securities.ToArray()));
        using(var sha=SHA256.Create()) {
          byte[] bytes=new byte[65536]; uint n; long total=0;
          do {
            Need(ReadFile(handles[handles.Count-1],bytes,(uint)bytes.Length,out n,IntPtr.Zero));
            total+=n; Need(total<=67108864); if(n>0) sha.TransformBlock(bytes,0,(int)n,bytes,0);
          } while(n>0);
          sha.TransformFinalBlock(new byte[0],0,0); result.executableSha256=Hex(sha.Hash);
        }
        for(int i=0;i<handles.Count;i++) {
          FileInfo after; Need(GetFileInformationByHandle(handles[i],out after) && Id(after)==ids[i] && (after.Attributes & 0x400)==0);
          bool safe; Need(Security(handles[i],out safe)==securities[i]);
          // Reopen current name while original handle is held; catches a changed pathname binding.
          using(var reopened=CreateFile(paths[i],0x20080u,1,IntPtr.Zero,3,0x02200000u,IntPtr.Zero)) {
            FileInfo other; Need(!reopened.IsInvalid && GetFileInformationByHandle(reopened,out other) && Id(other)==ids[i]);
          }
        }
        result.identitiesStable=true; result.status="DIAGNOSTIC_ONLY";
        result.reason=allSafe?"EFFECTIVE_ACCESS_UNPROVEN":"ACL_POLICY_DENIED";
      } catch { result.status="HOST_AUTHN_UNAVAILABLE"; result.reason="OS_EVIDENCE_DENIED"; }
      finally { foreach(var h in handles) h.Dispose(); }
      return result;
    }
    public static ProcessObservation ObserveCurrentProcess() {
      var result=new ProcessObservation();
      try {
        using(var process=Process.GetCurrentProcess()) {
          result.pid=process.Id; result.parentPid=Parent(process.Id);
          result.sessionId=process.SessionId; result.startFileTime=process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();
          result.uptimeMilliseconds=GetTickCount64().ToString();
          result.bootTimeFileTime=BootTime(); result.matchingServiceCount=ServiceCount(result.pid);
          SafeFileHandle token; Need(OpenProcessToken(GetCurrentProcess(),8,out token));
          using(token) {
            result.userSid=TokenSid(token,1); result.integritySid=TokenSid(token,25);
            result.elevated=TokenValue(token,20,p=>Marshal.ReadInt32(p).ToString())=="1";
            // TOKEN_STATISTICS: AuthenticationId is the second LUID.
            result.authenticationId=TokenValue(token,10,p=>Marshal.ReadInt64(p,8).ToString());
            result.tokenObserved=true;
            var path=new StringBuilder(2048); uint n=2048;
            Need(QueryFullProcessImageName(GetCurrentProcess(),0,path,ref n) && n>0 && n<2048);
            result.executable=ObservePath(path.ToString());
            result.identityStable=result.userSid==TokenSid(token,1) &&
              result.authenticationId==TokenValue(token,10,p=>Marshal.ReadInt64(p,8).ToString()) &&
              result.startFileTime==process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() &&
              result.sessionId==process.SessionId;
            SafeFileHandle fresh;
            Need(OpenProcessToken(GetCurrentProcess(),8,out fresh));
            using(fresh) {
              result.identityStable &= result.userSid==TokenSid(fresh,1) && result.integritySid==TokenSid(fresh,25) &&
                result.authenticationId==TokenValue(fresh,10,p=>Marshal.ReadInt64(p,8).ToString());
            }
            result.bootTimeStable=result.bootTimeFileTime==BootTime();
            Need(result.identityStable && result.bootTimeStable);
          }
        }
      } catch { result.reason="HOST_AUTHN_UNAVAILABLE"; result.identityStable=false; }
      return result;
    }
  }
}
