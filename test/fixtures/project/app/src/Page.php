<?php

use SilverStripe\CMS\Model\SiteTree;

class Page extends SiteTree
{
    private static $db = [
        'Tagline' => 'Varchar(255)',
    ];
}

class PageController
{
    public function getIsDev()
    {
        return false;
    }

    public function hasBanner()
    {
        return true;
    }
}
