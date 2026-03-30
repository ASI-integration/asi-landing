$id = Start-Process powershell -ArgumentList "-Command `"vercel logs asi-landing-new.vercel.app > c:\projects\asi-landing\logs2.txt`"" -PassThru
Start-Sleep -Seconds 5
$body = Get-Content c:\projects\asi-landing\mock_update.json -Raw
Invoke-RestMethod -Uri "https://asi-landing-new.vercel.app/api/telegram/webhook" -Method Post -ContentType "application/json" -Body $body
Start-Sleep -Seconds 8
Stop-Process -Id $id.Id
