[IO.File]::WriteAllText("c:\projects\asi-landing\var_url.txt", "https://openrouter.ai/api/v1")
[IO.File]::WriteAllText("c:\projects\asi-landing\var_reply.txt", "true")
[IO.File]::WriteAllText("c:\projects\asi-landing\var_provider.txt", "telegram")

vercel env rm LLM_BASE_URL production -y
cmd /c "vercel env add LLM_BASE_URL production < c:\projects\asi-landing\var_url.txt"

vercel env rm AI_REPLY_ENABLED production -y
cmd /c "vercel env add AI_REPLY_ENABLED production < c:\projects\asi-landing\var_reply.txt"

vercel env rm COMMUNICATION_DELIVERY_PROVIDER production -y
cmd /c "vercel env add COMMUNICATION_DELIVERY_PROVIDER production < c:\projects\asi-landing\var_provider.txt"
