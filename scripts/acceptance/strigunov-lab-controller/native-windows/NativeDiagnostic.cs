// Fixed read-only diagnostic executable. Built only in a disposable test directory.
// Never signed/installed as a service, never accepted as host authorization.
using System;
using System.IO;
using System.Web.Script.Serialization;
using Asi.Strigunov.NativeWindows;
public static class NativeDiagnostic {
  public static int Main(string[] args) {
    object result;
    try {
      if(args.Length==0) result=Observer.ObserveCurrentProcess();
      else {
        if(args.Length!=2 || args[0]!="--unit-fixtures") throw new InvalidOperationException();
        string root=Path.GetFullPath(args[1]);
        if(!Path.GetFileName(root).StartsWith(".native-probe-unit-",StringComparison.Ordinal)) throw new InvalidOperationException();
        result=new {
          authorityClass="UNIT_ONLY", executionAuthorized=false,
          ordinary=Observer.ObservePath(Path.Combine(root,"actual","sample.txt")),
          junction=Observer.ObservePath(Path.Combine(root,"alias","sample.txt")),
          ads=Observer.ObservePath(Path.Combine(root,"actual","sample.txt")+":stream"),
          absent=Observer.ObservePath(Path.Combine(root,"actual","absent.txt"))
        };
      }
      string text=new JavaScriptSerializer().Serialize(result);
      if(System.Text.Encoding.UTF8.GetByteCount(text)>8192) throw new InvalidOperationException();
      Console.WriteLine(text);return 2;
    } catch {
      Console.WriteLine("{\"state\":\"BLOCKED\",\"reason\":\"HOST_AUTHN_UNAVAILABLE\",\"executionAuthorized\":false}");
      return 2;
    }
  }
}
