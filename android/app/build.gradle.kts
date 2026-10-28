import java.util.Properties

plugins {
    id("com.android.application")
}

// The app version follows package.json: 0.2.0 → versionName "0.2.0", versionCode 200
val webVersion = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootDir.resolve("../package.json").readText())!!.groupValues[1]
val (major, minor, patch) = webVersion.substringBefore('-').split('.').map { it.toInt() }

// Release signing: android/keystore.properties (not in git) — see README, «Android-приложение»
val keystoreProps = rootDir.resolve("keystore.properties").takeIf { it.exists() }
    ?.let { file -> Properties().apply { file.inputStream().use(::load) } }

android {
    namespace = "com.ironcore.aicommander"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ironcore.aicommander"
        minSdk = 26
        targetSdk = 36
        versionCode = major * 10000 + minor * 100 + patch
        versionName = webVersion
    }

    signingConfigs {
        if (keystoreProps != null) {
            create("release") {
                storeFile = rootDir.resolve(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // without keystore.properties assembleRelease leaves an unsigned APK
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    // the newest that still compile against android-36 (core 1.19 needs compileSdk 37)
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core:1.18.0")
    implementation("androidx.webkit:webkit:1.18.0")
}

// The game itself is the Vite build in src/main/assets/web; Gradle does not run npm
val checkWebBuild = tasks.register("checkWebBuild") {
    val index = layout.projectDirectory.file("src/main/assets/web/index.html")
    doLast {
        if (!index.asFile.exists()) {
            throw GradleException("No web build in app/src/main/assets/web: run `npm run build:android` in the repository root first")
        }
    }
}
tasks.named("preBuild") { dependsOn(checkWebBuild) }
