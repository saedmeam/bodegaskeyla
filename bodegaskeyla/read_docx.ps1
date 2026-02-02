param (
    [string]$docxPath,
    [string]$outputPath
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
    $doc = $word.Documents.Open($docxPath)
    $text = $doc.Content.Text
    $text | Out-File -FilePath $outputPath -Encoding utf8
    $doc.Close()
}
catch {
    Write-Error $_.Exception.Message
}
finally {
    $word.Quit()
}
