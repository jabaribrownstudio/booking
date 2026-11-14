package com.jabaribrownstudio.admin

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Light = lightColorScheme(
    primary = Color(0xFF3A4046), onPrimary = Color.White,
    primaryContainer = Color(0xFFE2E6EA), onPrimaryContainer = Color(0xFF1B1F23),
    secondary = Color(0xFF5C6670), secondaryContainer = Color(0xFFE2E6EA), onSecondaryContainer = Color(0xFF1B1F23),
    background = Color(0xFFF4F5F7), onBackground = Color(0xFF1B1F23),
    surface = Color.White, onSurface = Color(0xFF1B1F23),
    surfaceVariant = Color(0xFFECEFF2), onSurfaceVariant = Color(0xFF5C6670),
    surfaceContainerLow = Color.White, surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFF1F3F5), surfaceContainerHighest = Color(0xFFECEFF2),
    outline = Color(0xFFB4BCC3), outlineVariant = Color(0xFFDDE2E6),
    error = Color(0xFFB3261E)
)

private val Dark = darkColorScheme(
    primary = Color(0xFFC5CCD1), onPrimary = Color(0xFF1B1F23),
    primaryContainer = Color(0xFF3A4046), onPrimaryContainer = Color(0xFFF1F3F5),
    secondary = Color(0xFFA9B2BA), secondaryContainer = Color(0xFF353B42), onSecondaryContainer = Color(0xFFF1F3F5),
    background = Color(0xFF111417), onBackground = Color(0xFFF1F3F5),
    surface = Color(0xFF1B1F23), onSurface = Color(0xFFF1F3F5),
    surfaceVariant = Color(0xFF2A2F36), onSurfaceVariant = Color(0xFFA9B2BA),
    surfaceContainerLow = Color(0xFF1B1F23), surfaceContainer = Color(0xFF1F2429), surfaceContainerHigh = Color(0xFF2A2F36), surfaceContainerHighest = Color(0xFF30363D),
    outline = Color(0xFF5C6670), outlineVariant = Color(0xFF353B42),
    error = Color(0xFFF2B8B5)
)

object StatusColors {
    fun fg(status: String, dark: Boolean): Color = when (status) {
        "Confirmed" -> if (dark) Color(0xFF5BD39A) else Color(0xFF1E7B4F)
        "Pending" -> if (dark) Color(0xFFF2B64B) else Color(0xFF9A5F00)
        else -> if (dark) Color(0xFFA9B2BA) else Color(0xFF5C6670)
    }
    fun bg(status: String, dark: Boolean): Color = when (status) {
        "Confirmed" -> if (dark) Color(0xFF173B2B) else Color(0xFFE3F4EB)
        "Pending" -> if (dark) Color(0xFF45340F) else Color(0xFFFCF0D9)
        else -> if (dark) Color(0xFF2A2F36) else Color(0xFFECEFF2)
    }
}

@Composable
fun StudioTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) Dark else Light,
        shapes = Shapes(
            extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(22.dp), extraLarge = RoundedCornerShape(28.dp)
        ),
        typography = Typography(
            headlineMedium = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp),
            titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
            titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
            bodyLarge = TextStyle(fontSize = 16.sp),
            bodyMedium = TextStyle(fontSize = 14.sp),
            labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
            labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
            labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.6.sp)
        ),
        content = content
    )
}
