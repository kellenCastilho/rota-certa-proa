package com.kellencastilho.darota;
public class RouteProgressTest {
    static void check(boolean ok,String message) { if(!ok) throw new AssertionError(message); }
    public static void main(String[] args) {
        RouteProgress route=new RouteProgress(new double[][]{{0,0},{0,0.001},{0,0.002},{0.001,0.002}});
        check(route.locate(new double[]{0,0.0005},true)<1,"on route");
        check(Math.abs(route.progress-55.6)<1,"position projected along road");
        route.locate(new double[]{0,0.0015},true);
        double advanced=route.progress;
        route.locate(new double[]{0,0.0014},true);
        check(route.progress==advanced,"GPS jitter must not return to a passed maneuver");
        double offset=route.locate(new double[]{0.01,0.0015},true);
        check(offset>60 && route.progress==advanced,"off route must not advance instructions");
        check(RouteProgress.stage(251)==0 && RouteProgress.stage(250)==1 && RouteProgress.stage(100)==2 && RouteProgress.stage(30)==3,"voice thresholds");
        RouteProgress loop=new RouteProgress(new double[][]{{0,0},{0,0.005},{0.005,0.005},{0.005,0},{0,0},{0,-0.005}});
        loop.locate(new double[]{0,0.0001},true);
        check(loop.progress<30,"crossing must not select a future lap");
        loop.locate(new double[]{0,0},true);
        check(loop.progress<30,"GPS jitter at crossing must not skip lap");
        System.out.println("RouteProgress: 7 regression checks passed");
    }
}
