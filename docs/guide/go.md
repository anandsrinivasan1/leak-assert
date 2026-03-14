# Go SDK

## Install

```sh
go get github.com/leak-assert/leak-assert-go
```

## LeakTest

```go
import leakassert "github.com/leak-assert/leak-assert-go"

func TestHandlerNoLeak(t *testing.T) {
    lt := leakassert.New(t, leakassert.Config{
        Warmup:      100,
        Iterations:  2000,
        SampleEvery: 40,
        ForceGC:     true,
    })

    lt.Run(func() {
        handler.ServeHTTP(w, fakeRequest())
    })

    lt.Assert(
        leakassert.GrowthRate("1kb/iter"),
        leakassert.Stable(5 * leakassert.MB),
        leakassert.Ceiling(200 * leakassert.MB),
        leakassert.GoroutinesStable(),
    )
    lt.PrintSummary()
}
```

## Object leak checker

```go
func TestHandlerObjectLeak(t *testing.T) {
    checker := leakassert.NewObjectLeakChecker(t)

    for i := 0; i < 1000; i++ {
        handler.ServeHTTP(w, fakeRequest())
    }

    checker.Check(leakassert.ObjectCheckOptions{
        MaxGoroutinesDelta:  2,
        MaxHeapObjectsDelta: 500,
    })
}
```

## HTTP sidecar

```go
mux := http.NewServeMux()
mux.Handle("/", myHandler)
leakassert.MountSidecar(mux, leakassert.SidecarOptions{})
http.ListenAndServe(":8080", mux)
// → GET /__leak_assert__/heap
```

## HTML + JUnit reports

```go
report := &leakassert.Report{
    Name:    "my-handler",
    Passed:  true,
    Slope:   42.5,
    Samples: lt.GetSamples(),
}
os.WriteFile("report.html", []byte(report.ToHTML()),  0644)
os.WriteFile("report.xml",  []byte(report.ToJUnit()), 0644)
```
