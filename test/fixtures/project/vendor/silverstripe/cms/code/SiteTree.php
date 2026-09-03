<?php

namespace SilverStripe\CMS\Model;

use SilverStripe\ORM\DataObject;

class SiteTree extends DataObject
{
    private static $db = [
        'Title' => 'Varchar(255)',
        'MenuTitle' => 'Varchar(100)',
        'Content' => 'HTMLText',
    ];

    public function Link($action = null) {}

    /**
     * @return \SilverStripe\ORM\DataList<\SilverStripe\CMS\Model\SiteTree>
     */
    public function Children() {}
}
