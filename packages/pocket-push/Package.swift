// swift-tools-version: 5.9
import PackageDescription
let package = Package(name:"PocketReaderPush", platforms:[.iOS(.v15)], products:[.library(name:"PocketReaderPush",targets:["PocketReaderPush"])],
 dependencies:[.package(url:"https://github.com/ionic-team/capacitor-swift-pm.git",exact:"8.6.2")],
 targets:[.target(name:"PocketReaderPush",dependencies:[.product(name:"Capacitor",package:"capacitor-swift-pm"),.product(name:"Cordova",package:"capacitor-swift-pm")],path:"ios/Sources/PocketPushPlugin")])
