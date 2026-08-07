import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

val videoFlowLocalProperties = Properties().apply {
  rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use(::load)
}

fun videoFlowConfig(name: String): String =
  providers.gradleProperty(name).orNull
    ?: System.getenv(name)
    ?: videoFlowLocalProperties.getProperty(name)
    ?: ""

fun buildConfigString(value: String) = "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.kotlin.plugin.serialization")
}

configurations.configureEach {
  resolutionStrategy.dependencySubstitution {
    substitute(module("com.clerk:clerk-android-telemetry:1.0"))
      .using(module("com.clerk:clerk-android-telemetry:1.0.6"))
  }
}

android {
  namespace = "com.videoflow.android"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.videoflow.android"
    minSdk = 26
    targetSdk = 36
    versionCode = 1
    versionName = "2.5.0"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    vectorDrawables.useSupportLibrary = true

    buildConfigField("String", "VIDEOFLOW_CONVEX_URL", buildConfigString(videoFlowConfig("VIDEOFLOW_CONVEX_URL")))
    buildConfigField("String", "VIDEOFLOW_CLERK_PUBLISHABLE_KEY", buildConfigString(videoFlowConfig("VIDEOFLOW_CLERK_PUBLISHABLE_KEY")))
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }
  packaging.resources.excludes += setOf(
    "/META-INF/{AL2.0,LGPL2.1}",
    "META-INF/versions/9/OSGI-INF/MANIFEST.MF",
  )
}

kotlin {
  compilerOptions {
    jvmTarget.set(JvmTarget.JVM_17)
  }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2026.06.00")
  val media3Version = "1.10.1"

  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation("androidx.core:core-ktx:1.16.0")
  implementation("androidx.activity:activity-compose:1.11.0")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")

  implementation("com.clerk:clerk-android-ui:1.0.36")
  implementation("com.clerk:clerk-convex-kotlin:0.15.0")
  implementation("dev.convex:android-convexmobile:0.8.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")

  implementation("androidx.media3:media3-common:$media3Version")
  implementation("androidx.media3:media3-exoplayer:$media3Version")
  implementation("androidx.media3:media3-ui:$media3Version")
  implementation("androidx.media3:media3-transformer:$media3Version")
  implementation("androidx.media3:media3-effect:$media3Version")

  testImplementation("junit:junit:4.13.2")
  androidTestImplementation("androidx.test.ext:junit:1.3.0")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
  androidTestImplementation("androidx.compose.ui:ui-test-junit4")
  debugImplementation("androidx.compose.ui:ui-tooling")
  debugImplementation("androidx.compose.ui:ui-test-manifest")
}
