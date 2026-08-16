package com.example

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.example.ui.MainAppScreen
import com.example.ui.theme.LocalHubTheme
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel8, sdk = [36])
class LocalHubRobolectricJourneyTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun testBuyerJourneyAndSimulationVisualVerification() {
        composeTestRule.setContent {
            LocalHubTheme {
                MainAppScreen()
            }
        }

        // Verify top simulation notice is rendered
        composeTestRule.onNodeWithTag("account_security_button").assertExists()
        composeTestRule.onNodeWithTag("buyer_nav_feed").assertExists()
        composeTestRule.onNodeWithTag("buyer_nav_ai_chat").assertExists()
        composeTestRule.onNodeWithTag("buyer_nav_cart_track").assertExists()

        // Capture screenshot of the Video Feed
        composeTestRule.onRoot().captureRoboImage(filePath = "src/test/screenshots/buyer_video_feed.png")

        // Switch to AI chat tab
        composeTestRule.onNodeWithTag("buyer_nav_ai_chat").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithTag("ai_shopping_chat_screen").assertExists()
        composeTestRule.onRoot().captureRoboImage(filePath = "src/test/screenshots/buyer_ai_chat.png")

        // Switch to Cart & Track tab
        composeTestRule.onNodeWithTag("buyer_nav_cart_track").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithTag("buyer_cart_and_tracking_screen").assertExists()
        composeTestRule.onRoot().captureRoboImage(filePath = "src/test/screenshots/buyer_cart_track.png")

        // Open Account Authentication / RBAC Simulator
        composeTestRule.onNodeWithTag("account_security_button").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithTag("account_switcher_dialog").assertExists()
        composeTestRule.onRoot().captureRoboImage(filePath = "src/test/screenshots/rbac_auth_dialog.png")
    }

    @Test
    fun testVendorHubAndStaffAdminScreenshots() {
        composeTestRule.setContent {
            LocalHubTheme {
                MainAppScreen()
            }
        }

        // Open Account Switcher and select Vendor
        composeTestRule.onNodeWithTag("account_security_button").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithTag("select_account_vendor").performClick()
        composeTestRule.waitForIdle()

        // Verify Vendor Dashboard
        composeTestRule.onNodeWithTag("vendor_dashboard_screen").assertExists()
        composeTestRule.onRoot().captureRoboImage(filePath = "src/test/screenshots/vendor_dashboard.png")

        // Open Account Switcher and select Staff Admin
        composeTestRule.onNodeWithTag("account_security_button").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithTag("select_account_staff").performClick()
        composeTestRule.waitForIdle()

        // Verify Staff Admin Screen
        composeTestRule.onNodeWithTag("staff_admin_screen").assertExists()
        composeTestRule.onRoot().captureRoboImage(filePath = "src/test/screenshots/staff_admin.png")
    }
}
